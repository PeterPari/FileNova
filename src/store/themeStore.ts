import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Theme = 'light' | 'dark' | 'system';
export type FontSize = 'small' | 'medium' | 'large';
export type DateFormat = 'relative' | 'absolute';

interface ThemeState {
  theme: Theme;
  activeTheme: 'light' | 'dark'; // Resolved theme
  fontSize: FontSize;
  compactMode: boolean;
  showFileExtensions: boolean;
  showHiddenFiles: boolean;
  dateFormat: DateFormat;
  
  // Actions
  setTheme: (theme: Theme) => void;
  setFontSize: (size: FontSize) => void;
  setCompactMode: (enabled: boolean) => void;
  setShowFileExtensions: (show: boolean) => void;
  setShowHiddenFiles: (show: boolean) => void;
  setDateFormat: (format: DateFormat) => void;
  initializeTheme: () => void;
}

// Detect system theme preference
const getSystemTheme = (): 'light' | 'dark' => {
  if (typeof window === 'undefined') return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

// Resolve the active theme based on preference
const resolveTheme = (theme: Theme): 'light' | 'dark' => {
  if (theme === 'system') {
    return getSystemTheme();
  }
  return theme;
};

// Apply theme to document
const applyTheme = (theme: 'light' | 'dark', fontSize: FontSize, compactMode: boolean) => {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.setAttribute('data-font-size', fontSize);
  document.documentElement.setAttribute('data-compact', String(compactMode));
  
  // Also add class for Tailwind dark mode
  if (theme === 'dark') {
    document.documentElement.classList.add('dark');
  } else {
    document.documentElement.classList.remove('dark');
  }
};

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: 'system',
      activeTheme: getSystemTheme(),
      fontSize: 'medium',
      compactMode: false,
      showFileExtensions: true,
      showHiddenFiles: false,
      dateFormat: 'relative',

      setTheme: (theme: Theme) => {
        const activeTheme = resolveTheme(theme);
        set({ theme, activeTheme });
        const { fontSize, compactMode } = get();
        applyTheme(activeTheme, fontSize, compactMode);
      },

      setFontSize: (fontSize: FontSize) => {
        set({ fontSize });
        const { activeTheme, compactMode } = get();
        applyTheme(activeTheme, fontSize, compactMode);
      },

      setCompactMode: (compactMode: boolean) => {
        set({ compactMode });
        const { activeTheme, fontSize } = get();
        applyTheme(activeTheme, fontSize, compactMode);
      },

      setShowFileExtensions: (show: boolean) => set({ showFileExtensions: show }),
      
      setShowHiddenFiles: (show: boolean) => set({ showHiddenFiles: show }),
      
      setDateFormat: (format: DateFormat) => set({ dateFormat: format }),

      initializeTheme: () => {
        const { theme, fontSize, compactMode } = get();
        const activeTheme = resolveTheme(theme);
        set({ activeTheme });
        applyTheme(activeTheme, fontSize, compactMode);

        // Listen for system theme changes
        if (typeof window !== 'undefined') {
          const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
          const handleChange = (e: MediaQueryListEvent) => {
            const { theme } = get();
            if (theme === 'system') {
              const newActiveTheme = e.matches ? 'dark' : 'light';
              set({ activeTheme: newActiveTheme });
              const { fontSize, compactMode } = get();
              applyTheme(newActiveTheme, fontSize, compactMode);
            }
          };
          
          mediaQuery.addEventListener('change', handleChange);
          
          return () => mediaQuery.removeEventListener('change', handleChange);
        }
      },
    }),
    {
      name: 'filenova-theme-storage',
    }
  )
);
