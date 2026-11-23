import { defineApiPlugin } from '@worktime3/api/plugin';
import { NotesController } from './notes.controller';

// Everything the plugin adds to the API is declared here; the core registers it (docs/PLUGINS.md).
export default defineApiPlugin({
  id: 'notes',
  controllers: [NotesController],
});
