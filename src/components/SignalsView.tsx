import type { Dispatch, SetStateAction } from 'react';
import { MessageCircle, Target, X } from 'lucide-react';
import PanelTitle from './PanelTitle';
import type { GameConfig, InterestStatus } from '../domain/types';
import type { getLikelyParticipants } from '../domain/participants';
import type { getStaffScripts } from '../domain/operations';
import type { GroupMeCandidate } from '../features/games/gamesWorkspace';

type SignalsViewProps = {
  games: GameConfig[];
  groupMeCandidates: GroupMeCandidate[];
  groupMeText: string;
  likelyParticipants: ReturnType<typeof getLikelyParticipants>;
  scriptTemplates: string[];
  staffScripts: ReturnType<typeof getStaffScripts>;
  statuses: InterestStatus[];
  onAcceptCandidate: (candidate: GroupMeCandidate) => void;
  onClose: () => void;
  onCopyMessage: (message: string) => void;
  onGroupMeTextChange: (value: string) => void;
  onOpenRoute: (target: 'builder' | 'customization') => void;
  onRejectCandidate: (id: string) => void;
  onScanMessages: () => void;
  onSetCandidates: Dispatch<SetStateAction<GroupMeCandidate[]>>;
  onUpdateScriptTemplate: (index: number, value: string) => void;
};

export default function SignalsView({
  games,
  groupMeCandidates,
  groupMeText,
  likelyParticipants,
  scriptTemplates,
  staffScripts,
  statuses,
  onAcceptCandidate,
  onClose,
  onCopyMessage,
  onGroupMeTextChange,
  onOpenRoute,
  onRejectCandidate,
  onScanMessages,
  onSetCandidates,
  onUpdateScriptTemplate
}: SignalsViewProps) {
  return (
    <main className="app-shell compact-shell">
      <header className="topbar">
        <div>
          <h1>Games</h1>
          <p className="page-subtitle">Outreach and player coordination</p>
        </div>
        <button className="ghost-button" onClick={onClose}>
          <X size={18} />
          Close
        </button>
      </header>

      <nav className="route-tabs" aria-label="Games sections">
        <button onClick={() => onOpenRoute('builder')}>Tonight</button>
        <span className="active" aria-current="page">Outreach</span>
        <button onClick={() => onOpenRoute('customization')}>Configuration</button>
      </nav>

      <section className="panel">
        <PanelTitle icon={<Target />} title="Likely Participants" />
        <div className="outreach-list">
          {likelyParticipants.map((item) => (
            <article className="outreach-card" key={item.id}>
              <div>
                <h3>{item.profile.name}</h3>
                <p>{item.game.name} - {item.reason.join(' - ')}</p>
                <small>{item.message}</small>
              </div>
              <div className="outreach-actions">
                <strong>{item.confidence >= 95 ? 'High' : item.confidence >= 70 ? 'Medium' : 'Low'}</strong>
                <button className="secondary-button" onClick={() => onCopyMessage(item.message)}>
                  Copy Text
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={<MessageCircle />} title="Message Scan" />
        <div className="integration-copy">
          <p>
            Paste room chat here to detect likely interest. Staff must review every match before it is added.
          </p>
          <textarea value={groupMeText} onChange={(event) => onGroupMeTextChange(event.target.value)} placeholder="Paste player interest messages for staff review" />
          <button className="secondary-button" onClick={onScanMessages}>Scan Pasted Messages</button>
          <div className="script-grid">
            {groupMeCandidates.map((candidate) => (
              <article className="script-card" key={candidate.id}>
                <div className="candidate-edit-grid">
                  <input
                    value={candidate.playerName}
                    onChange={(event) =>
                      onSetCandidates((candidates) =>
                        candidates.map((item) => (item.id === candidate.id ? { ...item, playerName: event.target.value } : item))
                      )
                    }
                  />
                  <select
                    value={candidate.gameId}
                    onChange={(event) =>
                      onSetCandidates((candidates) =>
                        candidates.map((item) => (item.id === candidate.id ? { ...item, gameId: event.target.value } : item))
                      )
                    }
                  >
                    {games.map((game) => (
                      <option key={game.id} value={game.id}>{game.name}</option>
                    ))}
                  </select>
                  <select
                    value={candidate.status}
                    onChange={(event) =>
                      onSetCandidates((candidates) =>
                        candidates.map((item) => (item.id === candidate.id ? { ...item, status: event.target.value as InterestStatus } : item))
                      )
                    }
                  >
                    {statuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </div>
                <p>{candidate.sourceText}</p>
                <small>{candidate.confidence}% confidence - staff review required</small>
                <div className="inline-actions">
                  <button className="secondary-button" onClick={() => onAcceptCandidate(candidate)}>Add</button>
                  <button className="ghost-button" onClick={() => onRejectCandidate(candidate.id)}>Reject</button>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="panel">
        <PanelTitle icon={<MessageCircle />} title="Templates" />
        <div className="script-template-list">
          {scriptTemplates.map((template, index) => (
            <label key={index}>
              Template {index + 1}
              <input value={template} onChange={(event) => onUpdateScriptTemplate(index, event.target.value)} />
            </label>
          ))}
        </div>
        <div className="script-grid">
          {staffScripts.map((script) => (
            <article className="script-card" key={script.label}>
              <strong>{script.label}</strong>
              <p>{script.text}</p>
              <button className="secondary-button" onClick={() => onCopyMessage(script.text)}>
                Copy
              </button>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
