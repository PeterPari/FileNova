import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface ChatFileResult {
  name: string;
  path: string;
  extension: string | null;
  size_bytes: number;
  modified_at: number;
}

export interface ChatAction {
  action_type: string;
  file_path: string;
  new_path: string | null;
  reason: string | null;
}

interface StatItem {
  label: string;
  value: string;
}

interface TrendPoint {
  date: string;
  count: number;
  size_bytes: number;
}

interface AnalysisData {
  title: string;
  summary: string;
  stats: StatItem[];
  trend_data?: TrendPoint[];
}

interface CompareResults {
  folder_a: string;
  folder_b: string;
  only_in_a: ChatFileResult[];
  only_in_b: ChatFileResult[];
  common_count: number;
  size_a_total: number;
  size_b_total: number;
}

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

interface ChatErrorInfo {
  error_type: string;
  message: string;
  did_you_mean: string[];
}

export interface ChatMetadata {
  intent: string;
  params?: JsonValue;
  files?: ChatFileResult[];
  actions?: ChatAction[];
  batch_id?: string;
  action_status?: string;
  suggestions?: string[];
  analysis_data?: AnalysisData;
  compare_results?: CompareResults;
  error_info?: ChatErrorInfo;
}

export interface ChatMessage {
  id: number;
  session_id: number;
  role: 'user' | 'assistant';
  content: string;
  metadata?: ChatMetadata;
  metadata_json?: string;
  created_at: string;
}

export interface ChatSession {
  id: number;
  started_at: string;
  last_message_at: string;
}

const getFriendlyErrorMessage = (error: unknown) => {
  const errorStr = String(error);
  if (errorStr.includes('API key') || errorStr.includes('api_key')) {
    return '⚠️ Please set your AI API key in Settings to use the assistant.';
  }
  if (errorStr.includes('network') || errorStr.includes('Network')) {
    return '⚠️ Network error — please check your internet connection.';
  }
  return '⚠️ Something went wrong. Please try again.';
};

const updateActionStatus = (message: ChatMessage, status: string) => {
  if (!message.metadata_json) {
    return message;
  }

  try {
    const meta = JSON.parse(message.metadata_json);
    meta.action_status = status;
    return { ...message, metadata_json: JSON.stringify(meta) };
  } catch {
    return message;
  }
};

export const useChatController = () => {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<number | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<number | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const result = await invoke<ChatSession[]>('get_chat_sessions');
      setSessions(result);
    } catch (error) {
      console.error('Failed to load sessions:', error);
    }
  }, []);

  const loadMessages = useCallback(async (id: number) => {
    try {
      const result = await invoke<ChatMessage[]>('get_chat_messages', { sessionId: id });
      setMessages(result);
    } catch (error) {
      console.error('Failed to load messages:', error);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (currentSessionId) {
      loadMessages(currentSessionId);
    } else {
      setMessages([]);
    }
  }, [currentSessionId, loadMessages]);

  const createSession = useCallback(async () => {
    const newId = await invoke<number>('create_chat_session');
    await loadSessions();
    setCurrentSessionId(newId);
    return newId;
  }, [loadSessions]);

  const handleNewChat = useCallback(async () => {
    try {
      await createSession();
    } catch (error) {
      console.error('Failed to create session:', error);
    }
  }, [createSession]);

  const handleSend = useCallback(async () => {
    if (!input.trim()) {
      return;
    }

    let sessionId = currentSessionId;
    if (!sessionId) {
      try {
        sessionId = await createSession();
      } catch (error) {
        console.error('Failed to create session:', error);
        return;
      }
    }

    const tempUserMsg: ChatMessage = {
      id: Date.now(),
      session_id: sessionId,
      role: 'user',
      content: input,
      created_at: new Date().toISOString(),
    };

    setMessages((prev) => [...prev, tempUserMsg]);
    setInput('');
    setIsLoading(true);

    try {
      const response = await invoke<{ message: ChatMessage }>('chat_query', {
        sessionId,
        message: tempUserMsg.content,
      });
      setMessages((prev) => [...prev, response.message]);
      loadSessions();
    } catch (error) {
      console.error('Chat query failed:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          session_id: sessionId,
          role: 'assistant',
          content: getFriendlyErrorMessage(error),
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setIsLoading(false);
    }
  }, [createSession, currentSessionId, input, loadSessions]);

  const handleConfirmAction = useCallback(async (msg: ChatMessage) => {
    if (!currentSessionId) {
      return;
    }

    setActionLoading(msg.id);
    try {
      const response = await invoke<{ message: ChatMessage }>('chat_execute_action', {
        messageId: msg.id,
        sessionId: currentSessionId,
      });
      setMessages((prev) => prev.map((message) => (message.id === msg.id ? updateActionStatus(message, 'confirmed') : message)));
      setMessages((prev) => [...prev, response.message]);
    } catch (error) {
      console.error('Action execution failed:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          session_id: currentSessionId,
          role: 'assistant',
          content: `❌ Failed to execute action: ${error}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setActionLoading(null);
    }
  }, [currentSessionId]);

  const handleCancelAction = useCallback((msg: ChatMessage) => {
    if (!currentSessionId) {
      return;
    }

    setMessages((prev) => prev.map((message) => (message.id === msg.id ? updateActionStatus(message, 'cancelled') : message)));
    setMessages((prev) => [
      ...prev,
      {
        id: Date.now(),
        session_id: currentSessionId,
        role: 'assistant',
        content: '🚫 Action cancelled. No changes were made.',
        created_at: new Date().toISOString(),
      },
    ]);
  }, [currentSessionId]);

  const handleUndoAction = useCallback(async (batchId: string) => {
    if (!currentSessionId) {
      return;
    }

    setActionLoading(-1);
    try {
      const response = await invoke<{ message: ChatMessage }>('chat_undo_action', {
        batchId,
        sessionId: currentSessionId,
      });
      setMessages((prev) => prev.map((message) => (message.metadata_json?.includes(batchId) ? updateActionStatus(message, 'undone') : message)));
      setMessages((prev) => [...prev, response.message]);
    } catch (error) {
      console.error('Undo failed:', error);
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          session_id: currentSessionId,
          role: 'assistant',
          content: `❌ Undo failed: ${error}`,
          created_at: new Date().toISOString(),
        },
      ]);
    } finally {
      setActionLoading(null);
    }
  }, [currentSessionId]);

  return {
    sessions,
    currentSessionId,
    setCurrentSessionId,
    messages,
    input,
    setInput,
    isLoading,
    actionLoading,
    handleNewChat,
    handleSend,
    handleConfirmAction,
    handleCancelAction,
    handleUndoAction,
  };
};
