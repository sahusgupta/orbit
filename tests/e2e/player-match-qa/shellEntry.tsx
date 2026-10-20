import { createRoot } from 'react-dom/client';
import PlayerApp from '../../../player-app/src/PlayerApp';

// The actual shell owns its theme, demo mode, screen routing and all rendered presentation.
createRoot(document.getElementById('root')!).render(<PlayerApp />);
