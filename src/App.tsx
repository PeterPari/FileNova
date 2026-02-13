import './App.css';
import { useState, useEffect, lazy, Suspense } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useFileStore } from './store/fileStore';
import { StartupTracker } from './utils/performance';

const Layout = lazy(() => import('./components/Layout').then((m) => ({ default: m.Layout })));
const FileBrowser = lazy(() => import('./components/FileBrowser').then((m) => ({ default: m.FileBrowser })));
const AnalyticsDashboard = lazy(() => import('./components/AnalyticsDashboard').then((m) => ({ default: m.AnalyticsDashboard })));
const DuplicateReview = lazy(() => import('./components/DuplicateReview').then((m) => ({ default: m.DuplicateReview })));
const SemanticSearch = lazy(() => import('./components/SemanticSearch').then((m) => ({ default: m.SemanticSearch })));
const ActivityFeed = lazy(() => import('./components/ActivityFeed').then((m) => ({ default: m.ActivityFeed })));
const Organize = lazy(() => import('./pages/Organize'));
const RulesManager = lazy(() => import('./components/RulesManager').then((m) => ({ default: m.RulesManager })));
const TrashManager = lazy(() => import('./components/TrashManager').then((m) => ({ default: m.TrashManager })));
const Chat = lazy(() => import('./components/Chat').then((m) => ({ default: m.Chat })));
const OnboardingFlow = lazy(() => import('./components/OnboardingFlow').then((m) => ({ default: m.OnboardingFlow })));

function App() {
  const { currentView, setCurrentView } = useFileStore();
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
    return (
      <Suspense
        fallback={
          <div className="flex items-center justify-center h-screen bg-[var(--bg-base)]">
            <div className="text-[var(--text-primary)]">Loading...</div>
          </div>
        }
      >
        <OnboardingFlow
          onComplete={() => {
            setCurrentView('browser');
            setShowOnboarding(false);
          }}
        />
      </Suspense>
    );
  }

  const renderCurrentView = () => {
    switch (currentView) {
      case 'dashboard':
        return <AnalyticsDashboard />;
      case 'duplicates':
        return <DuplicateReview />;
      case 'semantic-search':
        return <SemanticSearch />;
      case 'activity':
        return <ActivityFeed />;
      case 'organize':
        return <Organize />;
      case 'rules':
        return <RulesManager />;
      case 'trash':
        return <TrashManager />;
      case 'chat':
        return <Chat />;
      case 'browser':
      default:
        return <FileBrowser />;
    }
  };

  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center h-screen bg-[var(--bg-base)]">
          <div className="text-[var(--text-primary)]">Loading...</div>
        </div>
      }
    >
      <Layout>
        {renderCurrentView()}
      </Layout>
    </Suspense>
  );
}

export default App;
