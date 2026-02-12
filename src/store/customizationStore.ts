import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SidebarSection {
  id: string;
  label: string;
  visible: boolean;
  order: number;
}

export interface FolderPreference {
  path: string;
  viewMode: 'grid' | 'list';
  sortColumn: string;
  sortDirection: 'asc' | 'desc';
  columnWidths?: Record<string, number>;
  iconSize?: number;
}

interface CustomizationState {
  // Sidebar
  sidebarWidth: number;
  sidebarCollapsed: boolean;
  sidebarSections: SidebarSection[];
  
  // Folder Preferences
  folderPreferences: Map<string, FolderPreference>;
  
  // Actions
  setSidebarWidth: (width: number) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarSections: (sections: SidebarSection[]) => void;
  toggleSectionVisibility: (id: string) => void;
  reorderSections: (draggedId: string, targetId: string) => void;
  
  setFolderPreference: (path: string, preference: Partial<FolderPreference>) => void;
  getFolderPreference: (path: string) => FolderPreference | undefined;
}

const defaultSections: SidebarSection[] = [
  { id: 'bookmarks', label: 'Bookmarks', visible: true, order: 0 },
  { id: 'drives', label: 'Drives', visible: true, order: 1 },
  { id: 'recent', label: 'Recent', visible: true, order: 2 },
];

export const useCustomizationStore = create<CustomizationState>()(
  persist(
    (set, get) => ({
      sidebarWidth: 240,
      sidebarCollapsed: false,
      sidebarSections: defaultSections,
      folderPreferences: new Map(),

      setSidebarWidth: (width: number) => {
        set({ sidebarWidth: Math.max(200, Math.min(400, width)) });
      },

      toggleSidebarCollapsed: () => {
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed }));
      },

      setSidebarSections: (sections: SidebarSection[]) => {
        set({ sidebarSections: sections });
      },

      toggleSectionVisibility: (id: string) => {
        set((state) => ({
          sidebarSections: state.sidebarSections.map((section) =>
            section.id === id ? { ...section, visible: !section.visible } : section
          ),
        }));
      },

      reorderSections: (draggedId: string, targetId: string) => {
        const sections = [...get().sidebarSections];
        const draggedIndex = sections.findIndex((s) => s.id === draggedId);
        const targetIndex = sections.findIndex((s) => s.id === targetId);

        if (draggedIndex === -1 || targetIndex === -1) return;

        const [removed] = sections.splice(draggedIndex, 1);
        sections.splice(targetIndex, 0, removed);

        // Update order property
        const reorderedSections = sections.map((section, index) => ({
          ...section,
          order: index,
        }));

        set({ sidebarSections: reorderedSections });
      },

      setFolderPreference: (path: string, preference: Partial<FolderPreference>) => {
        const current = get().folderPreferences.get(path);
        const updated = { ...current, path, ...preference } as FolderPreference;
        
        set((state) => {
          const newPreferences = new Map(state.folderPreferences);
          newPreferences.set(path, updated);
          return { folderPreferences: newPreferences };
        });
      },

      getFolderPreference: (path: string) => {
        return get().folderPreferences.get(path);
      },
    }),
    {
      name: 'filenova-customization-storage',
      partialize: (state) => ({
        sidebarWidth: state.sidebarWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        sidebarSections: state.sidebarSections,
        folderPreferences: Array.from(state.folderPreferences.entries()),
      }),
      merge: (persistedState: any, currentState) => ({
        ...currentState,
        ...persistedState,
        folderPreferences: new Map(persistedState.folderPreferences || []),
      }),
    }
  )
);
