import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { ExtractionStatus, IndexStatus } from '../store/fileStore';

interface UseAppEventsArgs {
  onIndexingProgress: (status: IndexStatus) => void;
  onExtractionProgress: (status: ExtractionStatus) => void;
  onSuspiciousActivity: () => void;
}

export const useAppEvents = ({
  onIndexingProgress,
  onExtractionProgress,
  onSuspiciousActivity,
}: UseAppEventsArgs) => {
  useEffect(() => {
    const unlistenIndex = listen<IndexStatus>('indexing_progress', (event) => {
      onIndexingProgress(event.payload);
    });

    const unlistenExtraction = listen<ExtractionStatus>('extraction_progress', (event) => {
      onExtractionProgress(event.payload);
    });

    const unlistenSuspicious = listen('suspicious_activity', () => {
      onSuspiciousActivity();
    });

    return () => {
      unlistenIndex.then((f) => f());
      unlistenExtraction.then((f) => f());
      unlistenSuspicious.then((f) => f());
    };
  }, [onIndexingProgress, onExtractionProgress, onSuspiciousActivity]);
};
