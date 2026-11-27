// A scroll bar that is always drawn: macOS and Chrome otherwise show one only while scrolling, and a scrolling pane
// (the Flows list, a dialog's tab) then looks like it ends where the window does. Firefox keeps its own.
export const VISIBLE_SCROLLBAR = {
  '&::-webkit-scrollbar': { width: 10 },
  '&::-webkit-scrollbar-track': { backgroundColor: 'transparent' },
  '&::-webkit-scrollbar-thumb': { backgroundColor: 'rgba(128, 128, 128, 0.45)', borderRadius: 5, border: '2px solid transparent', backgroundClip: 'padding-box' },
  '&::-webkit-scrollbar-thumb:hover': { backgroundColor: 'rgba(128, 128, 128, 0.7)' },
} as const;
