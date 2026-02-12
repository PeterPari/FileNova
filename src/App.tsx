import './App.css';
import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Layout } from './components/Layout';
import { FileBrowser } from './components/FileBrowser';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { DuplicateReview } from './components/DuplicateReview';
import { SemanticSearch } from './components/SemanticSearch';
import { ActivityFeed } from './components/ActivityFeed';
import Organize from './pages/Organize';
import { RulesManager } from './components/RulesManager';
import { TrashManager } from './components/TrashManager';
import { Chat } from './components/Chat';
import { OnboardingFlow } from './components/OnboardingFlow';
import { useFileStore } from './store/fileStore';
import { StartupTracker } from './utils/performance';

function App() {
  const { currentView } = useFileStore();
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    StartupTracker.mark('app-component-mounted');
    
    // Check if we need to show onboarding
    invoke<boolean>('get_onboarding_status')
      .then((completed) => {
        setShowOnboarding(!completed);
        setLoading(false);
        StartupTracker.mark('onboarding-check-complete');
      })
      .catch(() => {
        setShowOnboarding(true);
        setLoading(false);
      });

    // Mark app as interactive
    setTimeout(() => {
      StartupTracker.mark('interactive');
      if (import.meta.env.DEV) {
        StartupTracker.report();
      }
    }, 0);
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[var(--bg-base)]">
        <div className="text-[var(--text-primary)]">Loading...</div>
      </div>
    );
  }

  if (showOnboarding) {
    return <OnboardingFlow onComplete={() => setShowOnboarding(false)} />;
  }

  return (
    <Layout>
      {currentView === 'dashboard' && <AnalyticsDashboard />}
      {currentView === 'duplicates' && <DuplicateReview />}
      {currentView === 'browser' && <FileBrowser />}
      {currentView === 'semantic-search' && <SemanticSearch />}
      {currentView === 'activity' && <ActivityFeed />}
      {currentView === 'organize' && <Organize />}
      {currentView === 'rules' && <RulesManager />}
      {currentView === 'trash' && <TrashManager />}
      {currentView === 'chat' && <Chat />}
    </Layout>
  );
}

export default App;
