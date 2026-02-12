import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { Download, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { logger } from '../utils/logger';

interface DiagnosticInfo {
  version: string;
  os: string;
  arch: string;
  indexed_files: number;
  database_size_mb: number;
  memory_usage_mb: number;
  recent_errors: string[];
}

export const DiagnosticsPanel: React.FC = () => {
  const [diagnostics, setDiagnostics] = useState<DiagnosticInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [generated, setGenerated] = useState(false);

  const generateDiagnostics = async () => {
    setLoading(true);
    setGenerated(false);

    try {
      const info = await invoke<DiagnosticInfo>('generate_diagnostics');
      setDiagnostics(info);
      setGenerated(true);
      logger.info('Diagnostics generated successfully', 'Diagnostics');
    } catch (error) {
      logger.error('Failed to generate diagnostics', 'Diagnostics', error);
      alert('Failed to generate diagnostics. Check console for details.');
    } finally {
      setLoading(false);
    }
  };

  const exportDiagnostics = async () => {
    if (!diagnostics) return;

    try {
      const filePath = await save({
        defaultPath: `filenova-diagnostics-${new Date().toISOString().split('T')[0]}.txt`,
        filters: [{
          name: 'Text',
          extensions: ['txt']
        }]
      });

      if (filePath) {
        const report = [
          '=== FileNova Diagnostic Report ===',
          `Generated: ${new Date().toISOString()}`,
          '',
          '--- System Information ---',
          `Version: ${diagnostics.version}`,
          `OS: ${diagnostics.os}`,
          `Architecture: ${diagnostics.arch}`,
          '',
          '--- Application State ---',
          `Indexed Files: ${diagnostics.indexed_files.toLocaleString()}`,
          `Database Size: ${diagnostics.database_size_mb.toFixed(2)} MB`,
          `Memory Usage: ${diagnostics.memory_usage_mb.toFixed(2)} MB`,
          '',
          '--- Recent Errors ---',
          ...diagnostics.recent_errors.map((err, i) => `${i + 1}. ${err}`),
          '',
          '--- Frontend Logs ---',
          logger.exportLogs(),
        ].join('\n');

        await invoke('write_diagnostic_report', { path: filePath, content: report });
        logger.info('Diagnostics exported successfully', 'Diagnostics', { path: filePath });
      }
    } catch (error) {
      logger.error('Failed to export diagnostics', 'Diagnostics', error);
      alert('Failed to export diagnostics. Check console for details.');
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-2">
          System Diagnostics
        </h3>
        <p className="text-sm text-[var(--text-secondary)]">
          Generate a diagnostic report for troubleshooting issues or submitting bug reports.
        </p>
      </div>

      <div className="flex gap-3">
        <button
          onClick={generateDiagnostics}
          disabled={loading}
          className="px-4 py-2 bg-[var(--accent-blue)] hover:bg-[var(--accent-blue-hover)] text-white rounded-lg font-medium disabled:opacity-50 flex items-center gap-2 transition-colors"
        >
          {loading ? (
            <>
              <Loader2 size={16} className="animate-spin" />
              Generating...
            </>
          ) : (
            <>
              {generated ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
              Generate Report
            </>
          )}
        </button>

        {diagnostics && (
          <button
            onClick={exportDiagnostics}
            className="px-4 py-2 border border-[var(--border-primary)] hover:border-[var(--border-focus)] text-[var(--text-primary)] rounded-lg font-medium flex items-center gap-2 transition-colors"
          >
            <Download size={16} />
            Export Report
          </button>
        )}
      </div>

      {diagnostics && (
        <div className="bg-[var(--bg-secondary)] rounded-lg p-4 space-y-3 border border-[var(--border-primary)]">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <div className="text-sm text-[var(--text-secondary)]">Version</div>
              <div className="text-[var(--text-primary)] font-medium">{diagnostics.version}</div>
            </div>
            <div>
              <div className="text-sm text-[var(--text-secondary)]">Operating System</div>
              <div className="text-[var(--text-primary)] font-medium">{diagnostics.os}</div>
            </div>
            <div>
              <div className="text-sm text-[var(--text-secondary)]">Indexed Files</div>
              <div className="text-[var(--text-primary)] font-medium">
                {diagnostics.indexed_files.toLocaleString()}
              </div>
            </div>
            <div>
              <div className="text-sm text-[var(--text-secondary)]">Database Size</div>
              <div className="text-[var(--text-primary)] font-medium">
                {diagnostics.database_size_mb.toFixed(2)} MB
              </div>
            </div>
            <div>
              <div className="text-sm text-[var(--text-secondary)]">Memory Usage</div>
              <div className="text-[var(--text-primary)] font-medium">
                {diagnostics.memory_usage_mb.toFixed(2)} MB
              </div>
            </div>
            <div>
              <div className="text-sm text-[var(--text-secondary)]">Architecture</div>
              <div className="text-[var(--text-primary)] font-medium">{diagnostics.arch}</div>
            </div>
          </div>

          {diagnostics.recent_errors.length > 0 && (
            <div>
              <div className="text-sm text-[var(--text-secondary)] mb-2">Recent Errors</div>
              <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
                {diagnostics.recent_errors.map((err, i) => (
                  <div 
                    key={i} 
                    className="text-xs text-[var(--status-error)] bg-[var(--status-error)]/10 p-2 rounded"
                  >
                    {err}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
