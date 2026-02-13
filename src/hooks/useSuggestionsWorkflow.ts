import { useCallback, useEffect, useRef, useState } from 'react';
import type { Suggestion, SuggestionPlan } from '../components/Organize/SuggestionCard';
import { suggestionsService } from '../services/suggestionsService';

export interface WorkflowToast {
  message: string;
  type: 'success' | 'error' | 'info';
  action?: { label: string; onClick: () => void };
}

export const useSuggestionsWorkflow = () => {
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [toast, setToast] = useState<WorkflowToast | null>(null);
  const queueRef = useRef(Promise.resolve());

  const enqueue = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const run = queueRef.current.then(operation);
    queueRef.current = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setSuggestions(await suggestionsService.listPending());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh().catch((error) => {
      console.error('Failed to fetch suggestions:', error);
    });
  }, [refresh]);

  const handleAnalyze = useCallback(async () => {
    setAnalyzing(true);
    try {
      await enqueue(async () => {
        await suggestionsService.analyze();
        await refresh();
      });
    } catch (error) {
      console.error('Analysis failed:', error);
      setToast({ message: `Analysis failed: ${String(error)}`, type: 'error' });
    } finally {
      setAnalyzing(false);
    }
  }, [enqueue, refresh]);

  const handleUndo = useCallback(async (batchId: string) => {
    try {
      await enqueue(async () => {
        await suggestionsService.undoBatch(batchId);
        await refresh();
      });
      setToast({ message: 'Changes undone successfully.', type: 'success' });
    } catch (error) {
      setToast({ message: `Failed to undo changes: ${String(error)}`, type: 'error' });
    }
  }, [enqueue, refresh]);

  const handleAccept = useCallback(async (id: number) => {
    const previous = suggestions;
    setSuggestions((prev) => prev.filter((s) => s.id !== id));

    try {
      const batchId = await enqueue(async () => suggestionsService.accept(id));
      setToast({
        message: 'Suggestion applied successfully.',
        type: 'success',
        action: {
          label: 'Undo',
          onClick: () => {
            handleUndo(batchId).catch(console.error);
          },
        },
      });
    } catch (error) {
      setSuggestions(previous);
      setToast({ message: `Failed to execute suggestion: ${String(error)}`, type: 'error' });
    }
  }, [enqueue, handleUndo, suggestions]);

  const handleReject = useCallback(async (id: number) => {
    const previous = suggestions;
    setSuggestions((prev) => prev.filter((s) => s.id !== id));

    try {
      await enqueue(async () => suggestionsService.reject(id));
    } catch (error) {
      setSuggestions(previous);
      setToast({ message: `Failed to reject suggestion: ${String(error)}`, type: 'error' });
    }
  }, [enqueue, suggestions]);

  const handleModify = useCallback(async (id: number, updatedPlan: SuggestionPlan) => {
    const previous = suggestions;
    setSuggestions((prev) =>
      prev.map((s) => (s.id === id ? { ...s, plan_json: JSON.stringify(updatedPlan), status: 'modified' } : s)),
    );

    try {
      await enqueue(async () => suggestionsService.modify(id, updatedPlan));
    } catch (error) {
      setSuggestions(previous);
      setToast({ message: `Failed to update plan: ${String(error)}`, type: 'error' });
    }
  }, [enqueue, suggestions]);

  return {
    suggestions,
    loading,
    analyzing,
    toast,
    setToast,
    handleAnalyze,
    handleAccept,
    handleReject,
    handleModify,
  };
};
