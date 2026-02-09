import './App.css';
import { Layout } from './components/Layout';
import { FileBrowser } from './components/FileBrowser';
import { AnalyticsDashboard } from './components/AnalyticsDashboard';
import { DuplicateReview } from './components/DuplicateReview';
import { SemanticSearch } from './components/SemanticSearch';
import { ActivityFeed } from './components/ActivityFeed';
import Organize from './pages/Organize';
import { useFileStore } from './store/fileStore';

function App() {
  const { currentView } = useFileStore();

  return (
    <Layout>
      {currentView === 'dashboard' && <AnalyticsDashboard />}
      {currentView === 'duplicates' && <DuplicateReview />}
      {currentView === 'browser' && <FileBrowser />}
      {currentView === 'semantic-search' && <SemanticSearch />}
      {currentView === 'activity' && <ActivityFeed />}
      {currentView === 'organize' && <Organize />}
    </Layout>
  );
}

export default App;
