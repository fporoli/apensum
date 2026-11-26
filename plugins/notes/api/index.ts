import { defineApiPlugin } from '@worktime3/api/plugin';
import { NotesController } from './notes.controller';
import { NOTES_ASSISTANT_TOOLS } from './assistant-tools';

// Everything the plugin adds to the API is declared here; the core registers it (docs/PLUGINS.md).
export default defineApiPlugin({
  id: 'notes',
  controllers: [NotesController],
  // The AI assistant may list, write and delete the caller's own notes, through the controller above.
  assistantTools: NOTES_ASSISTANT_TOOLS,
});
