# FileNova Stage 11 Features - User Guide

## Theme System

### Accessing Theme Settings
1. Open Settings (click gear icon or press `Ctrl+,`)
2. Navigate to the **Appearance** tab
3. Choose your preferred theme:
   - **Light** - Bright theme for daytime use
   - **Dark** - Easy on eyes for low-light environments
   - **System** - Automatically follows your OS theme preference

### Customizing Appearance

**Font Size:**
- Small - Compact text for more screen space
- Medium - Default comfortable size
- Large - Better readability

**Compact Mode:**
- Reduces spacing and padding throughout the app
- Useful for smaller screens or to fit more content

**File Display Options:**
- Toggle "Show File Extensions" (.txt, .pdf, etc.)
- Toggle "Show Hidden Files" (files starting with .)

**Date Format:**
- **Relative**: "2 days ago", "just now", "3 weeks ago"
- **Absolute**: "Feb 10, 2026 at 3:45 PM"

## Sidebar Customization

### Resizing the Sidebar
- Hover over the sidebar edge until cursor changes
- Drag left or right to adjust width (200-400px)

### Collapsing the Sidebar
- Click the collapse button at the top of sidebar
- Press the keyboard shortcut (if configured)

### Organizing Sections
1. Go to Settings → Appearance
2. Under "Sidebar Sections":
   - Toggle visibility of sections (Bookmarks, Drives, Recent)
   - Drag sections to reorder them (if drag-drop is enabled)

## First-Time Setup (Onboarding)

When you first launch FileNova, you'll see a wizard:

### Step 1: Select Folders to Index
- Check suggested folders (Documents, Downloads, Desktop, Pictures)
- Click "Add Custom Folder..." to select additional directories
- **Warning**: Indexing entire drives can take a long time!

### Step 2: Choose AI Provider
- **Local (Ollama)**: 
  - ✅ Complete privacy, data stays on your machine
  - ✅ Free to use
  - ⚠️ Requires Ollama installation
  - ⚠️ Slower on older hardware
  
- **Cloud (OpenAI/Claude)**:
  - ✅ Faster and more powerful
  - ✅ Works on any hardware
  - ⚠️ Requires API key (paid)
  - ⚠️ Data sent to cloud

### Step 3: Initial Settings
- Choose your preferred theme
- Enable compact mode if desired
- Click "Start Indexing" to begin

### Step 4: Indexing Progress
- Watch the progress bar as FileNova catalogs your files
- This may take several minutes depending on file count
- You can use the app once indexing completes

## Performance Features

### Startup Tracking (Development Mode)
In development mode, FileNova tracks startup performance:
- Open browser console (F12) to see timing metrics
- Targets under 1 second to interactive

### Memory Monitoring
FileNova includes memory optimization:
- Thumbnail cache limited to 500 items (LRU eviction)
- Unused tabs unloaded if more than 10 are open
- Target: <150MB idle, <500MB active

### Virtual Scrolling
For directories with 100k+ files:
- Only visible items are rendered
- Smooth 60fps scrolling maintained
- Overscan of 5 items above/below viewport

## Diagnostics & Troubleshooting

### Generating a Diagnostic Report
1. Open Settings → Diagnostics tab
2. Click "Generate Report"
3. Review system information:
   - App version and OS
   - Number of indexed files
   - Database size and memory usage
   - Recent errors
4. Click "Export Report" to save as text file
5. Include this file when reporting bugs

### Database Maintenance
FileNova automatically maintains the database:
- Integrity checks on startup
- Weekly VACUUM operations to compact database
- Manual vacuum available in diagnostics

### Checking Index Health
If search results seem incorrect:
1. Go to Settings → Diagnostics
2. Click "Generate Report"
3. Check for database integrity issues
4. If corrupt, FileNova will offer to rebuild the index

## Error Handling Features

### Permission Errors
When FileNova can't access certain files:
- Files are automatically skipped during indexing
- Notification shows count of skipped files
- Details logged for review in diagnostics

### Network Drives
If network drives are unavailable:
- Visual indicator shows offline status
- 5-second timeout prevents app freezing
- Retry logic with exponential backoff

### File Conflicts
When moving/renaming files that already exist:
- FileNova detects the conflict
- Options presented:
  - Skip the operation
  - Overwrite existing file
  - Rename automatically (e.g., "file (1).txt")

### Long Paths (Windows)
For paths exceeding 260 characters:
- Automatically uses `\\?\` prefix
- Full path shown on hover
- Truncated in UI as "...folder/file.txt"

## Folder-Specific Preferences

FileNova remembers your preferences for each folder:

### Setting Preferences
1. Navigate to a folder
2. Change view mode (Grid/List)
3. Adjust sort order
4. Resize columns (List view) or icons (Grid view)
5. Preferences automatically saved

### Viewing Saved Preferences
All folder preferences persist across sessions and app restarts.

## Keyboard Shortcuts

### Global
- `Ctrl+,` - Open Settings
- `?` - Show keyboard shortcuts cheat sheet
- `Ctrl+K` - Open command palette

### Navigation
- `Arrow Keys` - Move selection
- `Backspace` - Navigate up one directory
- `Enter` - Open folder or file
- `Space` - Quick Look preview

### Views
- `Ctrl+1` - Grid view
- `Ctrl+2` - List view
- `Ctrl+B` - Toggle sidebar

## Tips & Best Practices

1. **Start Small**: Begin by indexing just your Documents and Downloads folders
2. **Choose the Right Theme**: Use Dark mode to reduce eye strain
3. **Enable Compact Mode**: On smaller screens or laptops
4. **Regular Diagnostics**: Run diagnostic reports monthly to catch issues early
5. **Monitor Performance**: Check memory usage if app feels sluggish
6. **Backup Before Major Operations**: Use FileNova workspace feature to save state

## Troubleshooting Common Issues

### App Feels Slow
1. Check memory usage in Diagnostics
2. Close unused tabs (keep under 10 open)
3. Clear thumbnail cache if needed
4. Enable compact mode to reduce UI complexity

### Theme Not Applying
1. Check Settings → Appearance
2. If "System" is selected, verify OS theme setting
3. Try manually selecting Light or Dark
4. Refresh the app

### Onboarding Won't Start
1. Delete app data directory
2. Restart FileNova
3. Onboarding wizard should appear

### Search Results Incomplete
1. Check indexing status in Settings → Indexing
2. Generate diagnostic report to check database health
3. Re-index if integrity check fails

## Getting Help

If you encounter issues:
1. Generate a diagnostic report (Settings → Diagnostics)
2. Check the console for errors (F12 → Console tab)
3. Export logs for debugging
4. Include diagnostics when reporting bugs

---

**FileNova is Production Ready!** 🎉

All Stage 11 polish and production features have been implemented and are ready for use.
