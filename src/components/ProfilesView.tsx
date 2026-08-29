import * as Dialog from '@radix-ui/react-dialog';
import { useState, type Dispatch, type DragEvent, type FormEvent, type RefObject, type SetStateAction } from 'react';
import { Archive, ArchiveRestore, BadgeCheck, Bell, Clock, Edit3, Plus, Save, ScanLine, Trash2, Upload, Users, X } from 'lucide-react';
import { hasProfileReference } from '../lib/profileRelationships';
import { calculatePlayerAge } from '../domain/governmentId';
import type { AppState, Interest, InterestStatus, PlayerProfile } from '../domain/types';
import type {
  NewProfileDraft,
  PlayerPopup,
  PlayerSection,
  TodayPlayerRow
} from '../features/profiles/profileWorkspace';
import PanelTitle from './PanelTitle';
import IdEnrollmentPanel from '../features/profiles/IdEnrollmentPanel';

type ProfilesViewProps = {
  state: AppState;
  activeMemberProfiles: PlayerProfile[];
  approvedMembershipProfiles: PlayerProfile[];
  archivedProfiles: PlayerProfile[];
  duplicateProfiles: PlayerProfile[][];
  editingProfileId: string | null;
  formatClock: (iso?: string) => string;
  formatHours: (hours: number) => string;
  getGameName: (gameId?: string) => string;
  getGamePlayEntries: (profile: PlayerProfile) => [string, number][];
  getMostPlayedGameName: (profile: PlayerProfile) => string;
  importProfileFile: (file?: File) => Promise<void>;
  profileImportMessage: string;
  importProfiles: () => void;
  importText: string;
  inClubInterests: Interest[];
  membershipDirectoryProfiles: PlayerProfile[];
  newProfile: NewProfileDraft;
  pendingMembershipProfiles: PlayerProfile[];
  playerPopup: PlayerPopup;
  playerSection: PlayerSection;
  profileEditDraft: PlayerProfile | null;
  profileFormMessage: string;
  profileSearch: string;
  qrManualValue: string;
  qrScanMessage: string;
  qrVideoRef: RefObject<HTMLVideoElement | null>;
  todayPlayerActivity: TodayPlayerRow[];
  approvePlayerIdentity: (profile: PlayerProfile) => void;
  addProfile: (event: FormEvent) => void;
  addProfileToClub: (profile: PlayerProfile) => void;
  approveMembershipRequest: (profile: PlayerProfile) => void;
  markMembershipPaidInPerson: (profile: PlayerProfile) => void;
  beginEditProfile: (profile: PlayerProfile) => void;
  cancelEditProfile: () => void;
  deleteInterest: (id: string) => void;
  archiveProfile: (profile: PlayerProfile) => void;
  mergeDuplicateProfiles: (profiles: PlayerProfile[]) => void;
  onOpenQrScanner: () => void;
  onRestartQrScanner: () => void;
  onSubmitQrManual: (event: FormEvent) => void;
  removeProfileFromClub: (profile: PlayerProfile) => void;
  restoreProfile: (profile: PlayerProfile) => void;
  saveProfileEdit: (event: FormEvent) => void;
  setImportText: Dispatch<SetStateAction<string>>;
  setNewProfile: Dispatch<SetStateAction<NewProfileDraft>>;
  setPlayerPopup: Dispatch<SetStateAction<PlayerPopup>>;
  setPlayerSection: Dispatch<SetStateAction<PlayerSection>>;
  setProfileEditDraft: Dispatch<SetStateAction<PlayerProfile | null>>;
  setProfileSearch: Dispatch<SetStateAction<string>>;
  setQrManualValue: Dispatch<SetStateAction<string>>;
  toLocalDateValue: (date: Date) => string;
};

export default function ProfilesView({
  state,
  activeMemberProfiles,
  approvedMembershipProfiles,
  archivedProfiles,
  duplicateProfiles,
  editingProfileId,
  formatClock,
  formatHours,
  getGameName,
  getGamePlayEntries,
  getMostPlayedGameName,
  importProfileFile,
  profileImportMessage,
  importProfiles,
  importText,
  inClubInterests,
  membershipDirectoryProfiles,
  newProfile,
  pendingMembershipProfiles,
  playerPopup,
  playerSection,
  profileEditDraft,
  profileFormMessage,
  profileSearch,
  qrManualValue,
  qrScanMessage,
  qrVideoRef,
  todayPlayerActivity,
  approvePlayerIdentity,
  addProfile,
  addProfileToClub,
  approveMembershipRequest,
  markMembershipPaidInPerson,
  beginEditProfile,
  cancelEditProfile,
  deleteInterest,
  archiveProfile,
  mergeDuplicateProfiles,
  onOpenQrScanner,
  onRestartQrScanner,
  onSubmitQrManual,
  removeProfileFromClub,
  restoreProfile,
  saveProfileEdit,
  setImportText,
  setNewProfile,
  setPlayerPopup,
  setPlayerSection,
  setProfileEditDraft,
  setProfileSearch,
  setQrManualValue,
  toLocalDateValue
}: ProfilesViewProps) {
  const [isImportDropActive, setIsImportDropActive] = useState(false);

  const handleImportDrop = async (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setIsImportDropActive(false);
    await importProfileFile(event.dataTransfer.files[0]);
  };

  const handleImportFileSelection = async (file?: File) => {
    if (!file) return;
    await importProfileFile(file);
  };

  return (
      <main className="app-shell compact-shell">
        <header className="topbar">
          <div>
            <h1>Players</h1>
            <p className="page-subtitle">Active memberships and today's player activity</p>
          </div>
          <div className="topbar-actions players-header-actions">
            <button
              className="player-tool-icon"
              onClick={onOpenQrScanner}
              title="Scan member QR"
              aria-label="Scan member QR"
            >
              <ScanLine size={19} />
            </button>
            <button className="player-tool-icon" onClick={() => setPlayerPopup('id')} title="Scan or swipe government ID" aria-label="Scan or swipe government ID"><BadgeCheck size={19} /></button>
            <button className="player-tool-icon" onClick={() => setPlayerPopup('ledger')} title="Open player ledger" aria-label="Open player ledger"><Clock size={19} /></button>
            <button className="player-tool-icon primary" onClick={() => setPlayerPopup('add')} title="Add player" aria-label="Add player"><Plus size={19} /></button>
          </div>
        </header>

        <Dialog.Root open={playerPopup !== null} onOpenChange={(open) => { if (!open) setPlayerPopup(null); }}>
          <Dialog.Portal>
            <Dialog.Overlay className="player-popup-overlay" />
            <Dialog.Content className="player-popup-content">
              <div className="player-popup-header">
                <div>
                  <Dialog.Title>{playerPopup === 'add' ? 'Add member' : playerPopup === 'id' ? 'Scan or swipe ID' : playerPopup === 'scan' ? 'Scan member QR' : 'Player ledger'}</Dialog.Title>
                  <Dialog.Description>
                    {playerPopup === 'add'
                      ? 'Record a walk-in membership paid at the club.'
                      : playerPopup === 'id'
                        ? 'Extract profile details from a government ID before creating the member.'
                      : playerPopup === 'scan'
                        ? 'Scan an active membership from Orbit Player to check the member in.'
                        : 'Recent check-ins and transactions.'}
                  </Dialog.Description>
                </div>
                <Dialog.Close asChild><button className="icon-button" aria-label="Close player form" title="Close player form"><X size={18} /></button></Dialog.Close>
              </div>
              {playerPopup === 'add' ? (
                <form className="player-popup-form" onSubmit={(event) => { addProfile(event); setPlayerPopup(null); }}>
                  <label><span>Player name</span><input autoFocus value={newProfile.name} onChange={(event) => setNewProfile({ ...newProfile, name: event.target.value })} placeholder="Full name" /></label>
                  <label><span>Phone</span><input value={newProfile.phone} onChange={(event) => setNewProfile({ ...newProfile, phone: event.target.value })} placeholder="Phone number" /></label>
                  <label><span>Address</span><input value={newProfile.address} onChange={(event) => setNewProfile({ ...newProfile, address: event.target.value })} placeholder="Street, city, state, postal code" /></label>
                  <label><span>Preferred game</span><select value={newProfile.preferredGameId} onChange={(event) => setNewProfile({ ...newProfile, preferredGameId: event.target.value, preferredGameIds: [event.target.value] })}>{state.games.map((game) => <option key={game.id} value={game.id}>{game.name}</option>)}</select></label>
                  <div className="player-popup-form-grid">
                    <label><span>Pass type</span><select value={newProfile.membershipPlan} onChange={(event) => setNewProfile({ ...newProfile, membershipPlan: event.target.value as 'day' | 'monthly' })}><option value="day">Day pass (24 hours)</option><option value="monthly">Monthly (30 days)</option></select></label>
                    <label><span>Amount paid in person</span><input type="number" min="0" step="0.01" value={newProfile.membershipAmount} onChange={(event) => setNewProfile({ ...newProfile, membershipAmount: Number(event.target.value) })} placeholder="0.00" /></label>
                  </div>
                  <label><span>Birthday{calculatePlayerAge(newProfile.birthday) != null ? ` · Age ${calculatePlayerAge(newProfile.birthday)}` : ''}</span><input type="date" value={newProfile.birthday} onChange={(event) => setNewProfile({ ...newProfile, birthday: event.target.value, identityCaptureMethod: undefined })} /></label>
                  <div className="club-data-import player-popup-import">
                    <strong>Import existing player data</strong>
                    <span>Choose or drop the club CSV/XLSX export to add its players.</span>
                    <label
                      className={`secondary-button license-file-button${isImportDropActive ? ' import-drop-active' : ''}`}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setIsImportDropActive(true);
                      }}
                      onDragOver={(event) => event.preventDefault()}
                      onDragLeave={(event) => {
                        if (event.currentTarget === event.target) setIsImportDropActive(false);
                      }}
                      onDrop={handleImportDrop}
                    >
                      <Upload size={16} />
                      <span>Choose or drop CSV/XLSX</span>
                      <input
                        type="file"
                        accept=".csv,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                        onChange={async (event) => {
                          await handleImportFileSelection(event.target.files?.[0]);
                          event.target.value = '';
                        }}
                      />
                    </label>
                    {profileImportMessage ? <p className="profile-import-message" role="status">{profileImportMessage}</p> : null}
                  </div>
                  <div className="player-popup-actions"><Dialog.Close asChild><button className="ghost-button" type="button">Cancel</button></Dialog.Close><button className="primary-button" type="submit">Add active member</button></div>
                </form>
              ) : playerPopup === 'id' ? (
                <IdEnrollmentPanel
                  minimumAge={state.settings.clubAccount?.minimumPlayerAge === 18 ? 18 : 21}
                  onApply={(identity) => {
                    setNewProfile((current) => ({
                      ...current,
                      name: identity.fullName,
                      birthday: identity.dateOfBirth,
                      address: identity.address,
                      identityCaptureMethod: 'id-barcode'
                    }));
                    setPlayerPopup('add');
                  }}
                />
              ) : playerPopup === 'scan' ? (
                <div className="membership-qr-scanner">
                  <div className="membership-qr-camera">
                    <video ref={qrVideoRef} autoPlay muted playsInline aria-label="Membership QR camera preview" />
                    <span className="membership-qr-frame" aria-hidden="true" />
                  </div>
                  <p className="membership-qr-message" role="status">{qrScanMessage}</p>
                  <form
                    className="membership-qr-manual"
                    onSubmit={onSubmitQrManual}
                  >
                    <label>
                      <span>USB scanner or QR value</span>
                      <input
                        value={qrManualValue}
                        onChange={(event) => setQrManualValue(event.target.value)}
                        placeholder="Scan or paste membership QR"
                        autoComplete="off"
                      />
                    </label>
                    <button className="primary-button" type="submit" disabled={!qrManualValue.trim()}>Check in</button>
                  </form>
                  <div className="membership-qr-actions">
                    <button
                      className="ghost-button"
                      type="button"
                      onClick={onRestartQrScanner}
                    >
                      Restart camera
                    </button>
                    <Dialog.Close asChild><button className="secondary-button" type="button">Done</button></Dialog.Close>
                  </div>
                </div>
              ) : (
                <div className="player-popup-ledger">
                  {state.playerLedger.length ? state.playerLedger.slice(0, 40).map((entry) => <article key={entry.id}><div><strong>{entry.playerName}</strong><span>{entry.type}{entry.note ? ` · ${entry.note}` : ''}</span></div><div><strong>{entry.amount !== undefined ? `$${entry.amount.toLocaleString()}` : 'Not recorded'}</strong><time>{formatClock(entry.timestamp)}</time></div></article>) : <div className="player-popup-empty"><strong>No ledger activity</strong><span>Check-ins and transactions will appear here.</span></div>}
                </div>
              )}
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>

        <nav className="route-tabs players-section-tabs" aria-label="Player sections">
          <button className={playerSection === 'memberships' ? 'active' : ''} onClick={() => setPlayerSection('memberships')}>
            Memberships <span>{membershipDirectoryProfiles.length}</span>
          </button>
          <button className={playerSection === 'requests' ? 'active' : ''} onClick={() => setPlayerSection('requests')}>
            Requests <span>{pendingMembershipProfiles.length + approvedMembershipProfiles.length}</span>
          </button>
          <button className={playerSection === 'today' ? 'active' : ''} onClick={() => setPlayerSection('today')}>
            Today <span>{todayPlayerActivity.length}</span>
          </button>
          <button className={playerSection === 'archive' ? 'active' : ''} onClick={() => setPlayerSection('archive')}>
            Past players <span>{archivedProfiles.length}</span>
          </button>
        </nav>

        {playerSection === 'memberships' ? <>

        <section className="profile-command-strip">
          <article>
            <span className="eyebrow">Directory health</span>
            <strong>{state.profiles.length} profiles</strong>
            <small>{inClubInterests.length} in club now</small>
          </article>
          <article>
            <span className="eyebrow">Memberships</span>
            <strong>{activeMemberProfiles.length} active</strong>
            <small>{pendingMembershipProfiles.length} new · {approvedMembershipProfiles.length} approved at door</small>
          </article>
          <div className="profile-command-actions">
            <button className="ghost-button" onClick={() => setProfileSearch('')}>
              Clear Search
            </button>
          </div>
        </section>

        <section className="profiles-layout">
          <section className="panel profile-directory-panel">
            <PanelTitle icon={<Users />} title="Player Directory" />
            <div className="profile-search-row">
              <input
                value={profileSearch}
                onChange={(event) => setProfileSearch(event.target.value)}
                placeholder="Search players, stakes, companions, notes"
              />
              <span>{membershipDirectoryProfiles.length} members shown</span>
            </div>
            {duplicateProfiles.length ? (
              <div className="duplicate-list">
                {duplicateProfiles.map((group) => (
                  <article className="duplicate-card" key={group[0].name.toLowerCase()}>
                    <span>Possible duplicate: {group.map((profile) => profile.name).join(', ')}</span>
                    <button className="secondary-button" onClick={() => mergeDuplicateProfiles(group)}>
                      Merge
                    </button>
                  </article>
                ))}
              </div>
            ) : null}
            <div className="profile-grid">
              {membershipDirectoryProfiles.map((profile) => {
                const preferredGame = state.games.find((game) => game.id === profile.preferredGameId)?.name ?? profile.preferredStakes;
                const gamePlayEntries = getGamePlayEntries(profile);
                const mostPlayedGame = getMostPlayedGameName(profile);
                const companionNames = profile.commonlyPlaysWithProfileIds
                  .map((id) => state.profiles.find((candidate) => candidate.id === id)?.name)
                  .filter(Boolean);
                const inClub = hasProfileReference(inClubInterests, state.profiles, profile);
                const seated = hasProfileReference(
                  state.playerSessions,
                  state.profiles,
                  profile,
                  (session) => !session.leftAt
                );
                const checkedIn = seated || inClub;
                return (
                  <article className="profile-card" key={profile.id}>
                    <div className="profile-card-main">
                      <div className="profile-card-header">
                        <div>
                          <h3>{profile.name}</h3>
                          <p>{preferredGame || 'No preferred game'}</p>
                        </div>
                        <span className={`status-pill${checkedIn ? ' viable' : ''}`}>
                          {seated ? 'Seated' : inClub ? 'In club' : 'Not checked in'}
                        </span>
                      </div>
                      <div className="profile-card-stats">
                        <span>Total <strong>{formatHours(profile.totalTimePlayedHours)}</strong></span>
                        <span>Last <strong>{formatHours(profile.lastSessionTimePlayedHours)}</strong></span>
                        <span>Saved time <strong>{profile.savedTimeCreditMinutes ?? 0} min</strong></span>
                        <span>Most played <strong>{mostPlayedGame}</strong></span>
                      </div>
                      {gamePlayEntries.length ? (
                        <div className="profile-game-counts">
                          {gamePlayEntries.slice(0, 4).map(([gameId, count]) => (
                            <span key={gameId}>{getGameName(gameId)}: <strong>{count}</strong></span>
                          ))}
                        </div>
                      ) : (
                        <small>No seated game history yet.</small>
                      )}
                      <small>Membership: {profile.membershipStartDate || 'Not set'} to {profile.membershipExpirationDate || 'Not set'}</small>
                      {profile.phone ? <small>Phone: {profile.phone}</small> : null}
                      {profile.email ? <small>Email: {profile.email}</small> : null}
                      {profile.orbitPlayerId ? <small>Orbit Player account linked</small> : null}
                      {profile.birthday ? <small>DOB: {profile.birthday}{calculatePlayerAge(profile.birthday) != null ? ` · Age ${calculatePlayerAge(profile.birthday)}` : ''}</small> : null}
                      {profile.address ? <small>Address: {profile.address}</small> : null}
                      {companionNames.length > 0 ? <small>Plays with: {companionNames.join(', ')}</small> : null}
                      {editingProfileId === profile.id && profileEditDraft ? (
                        <form className="profile-edit-form" onSubmit={saveProfileEdit}>
                          <input
                            value={profileEditDraft.name}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, name: event.target.value })}
                            placeholder="Player name"
                          />
                          <input
                            value={profileEditDraft.phone}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, phone: event.target.value })}
                            placeholder="Phone"
                          />
                          <input
                            type="email"
                            value={profileEditDraft.email ?? ''}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, email: event.target.value })}
                            placeholder="Orbit account email"
                          />
                          <input
                            value={profileEditDraft.address ?? ''}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, address: event.target.value })}
                            placeholder="Address"
                          />
                          <label>
                            Birthday
                            <input
                              type="date"
                              value={profileEditDraft.birthday}
                              onChange={(event) => setProfileEditDraft({ ...profileEditDraft, birthday: event.target.value })}
                            />
                          </label>
                          <label>
                            Member since
                            <input
                              type="date"
                              value={profileEditDraft.membershipStartDate}
                              onChange={(event) => setProfileEditDraft({ ...profileEditDraft, membershipStartDate: event.target.value })}
                            />
                          </label>
                          <label>
                            Expires
                            <input
                              type="date"
                              value={profileEditDraft.membershipExpirationDate}
                              onChange={(event) => setProfileEditDraft({ ...profileEditDraft, membershipExpirationDate: event.target.value })}
                            />
                          </label>
                          <select
                            value={profileEditDraft.preferredGameId}
                            onChange={(event) =>
                              setProfileEditDraft({
                                ...profileEditDraft,
                                preferredGameId: event.target.value,
                                preferredGameIds: Array.from(new Set([event.target.value, ...(profileEditDraft.preferredGameIds ?? [])]))
                              })
                            }
                          >
                            {state.games.map((game) => (
                              <option key={game.id} value={game.id}>
                                {game.name}
                              </option>
                            ))}
                          </select>
                          <input
                            value={profileEditDraft.preferredStakes}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, preferredStakes: event.target.value })}
                            placeholder="Preferred stakes"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={profileEditDraft.totalTimePlayedHours}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, totalTimePlayedHours: Number(event.target.value) })}
                            title="Total time played"
                          />
                          <input
                            type="number"
                            min="0"
                            step="0.1"
                            value={profileEditDraft.lastSessionTimePlayedHours}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, lastSessionTimePlayedHours: Number(event.target.value) })}
                            title="Last session time played"
                          />
                          <select
                            multiple
                            value={profileEditDraft.commonlyPlaysWithProfileIds}
                            onChange={(event) =>
                              setProfileEditDraft({
                                ...profileEditDraft,
                                commonlyPlaysWithProfileIds: Array.from(event.target.selectedOptions).map((option) => option.value)
                              })
                            }
                            title="Commonly plays with"
                          >
                            {state.profiles
                              .filter((candidate) => candidate.id !== profile.id)
                              .map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.name}
                                </option>
                              ))}
                          </select>
                          <textarea
                            value={profileEditDraft.notes}
                            onChange={(event) => setProfileEditDraft({ ...profileEditDraft, notes: event.target.value })}
                            placeholder="Owner notes"
                          />
                          <div className="profile-edit-actions">
                            <button className="primary-button" type="submit">
                              <Save size={16} />
                              Save
                            </button>
                            <button className="ghost-button" type="button" onClick={cancelEditProfile}>
                              Cancel
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </div>
                    <div className="profile-actions">
                      <button className="secondary-button" onClick={() => beginEditProfile(profile)}>
                        <Edit3 size={16} />
                        Edit
                      </button>
                      <button className="secondary-button" onClick={() => (checkedIn ? removeProfileFromClub(profile) : addProfileToClub(profile))}>
                        {checkedIn ? 'Check out' : 'Check in'}
                      </button>
                      <button aria-label={`Archive ${profile.name}`} className="icon-button" onClick={() => archiveProfile(profile)} title="Move to past players">
                        <Archive size={17} />
                      </button>
                    </div>
                  </article>
                );
              })}
              {!membershipDirectoryProfiles.length ? <p className="muted-copy">No matching memberships.</p> : null}
            </div>
          </section>

          <div className="profiles-right-column">
            <section className="panel">
              <PanelTitle icon={<Users />} title="In Club" />
              <div className="club-list">
                {inClubInterests.length ? (
                  inClubInterests.map((interest) => (
                    <article className="club-card" key={interest.id}>
                      <div>
                        <strong>{interest.playerName}</strong>
                        <small>{state.games.find((game) => game.id === interest.gameId)?.name ?? 'Unknown game'}</small>
                      </div>
                      <button className="secondary-button" onClick={() => deleteInterest(interest.id)}>
                        Check out
                      </button>
                    </article>
                  ))
                ) : (
                  <p className="muted-copy">No one marked in club.</p>
                )}
              </div>
            </section>

            <section className="panel">
              <PanelTitle icon={<Plus />} title="Add Players" />
              <div className="profile-form-hint">
                <strong>Quick profile builder</strong>
                <span>Create a usable player record for recommendations, waitlist matching, and loyalty tracking.</span>
              </div>
              <form className="profile-form" onSubmit={addProfile}>
                <input
                  className="profile-form-name"
                  value={newProfile.name}
                  onChange={(event) => setNewProfile({ ...newProfile, name: event.target.value })}
                  placeholder="Player name"
                />
                <input
                  value={newProfile.phone}
                  onChange={(event: { target: { value: string; }; }) => setNewProfile({ ...newProfile, phone: event.target.value })}
                  placeholder="Phone"
                  title="Phone"
                />
                <input
                  type="email"
                  value={newProfile.email}
                  onChange={(event) => setNewProfile({ ...newProfile, email: event.target.value })}
                  placeholder="Orbit account email"
                  title="Orbit account email"
                />
                <select
                  className="profile-form-game"
                  value={newProfile.preferredGameId}
                  onChange={(event) =>
                    setNewProfile({
                      ...newProfile,
                      preferredGameId: event.target.value,
                      preferredGameIds: [event.target.value]
                    })
                  }
                  title="Preferred game"
                >
                  {state.games.map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name}
                    </option>
                  ))}
                </select>
                <input
                  type="date"
                  value={newProfile.birthday}
                  onChange={(event: { target: { value: string; }; }) => setNewProfile({ ...newProfile, birthday: event.target.value })}
                  title="Birthday"
                />
                <input
                  type="date"
                  value={newProfile.membershipStartDate}
                  onChange={(event: { target: { value: string; }; }) => setNewProfile({ ...newProfile, membershipStartDate: event.target.value })}
                  title="Membership start"
                />
                <input
                  type="date"
                  value={newProfile.membershipExpirationDate}
                  onChange={(event: { target: { value: string; }; }) => setNewProfile({ ...newProfile, membershipExpirationDate: event.target.value })}
                  title="Membership expiration"
                />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={newProfile.totalTimePlayedHours}
                  onChange={(event) => setNewProfile({ ...newProfile, totalTimePlayedHours: Number(event.target.value) })}
                  title="Total time played"
                />
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={newProfile.lastSessionTimePlayedHours}
                  onChange={(event) => setNewProfile({ ...newProfile, lastSessionTimePlayedHours: Number(event.target.value) })}
                  title="Last session time played"
                />
                <select
                  className="profile-form-companions"
                  multiple
                  value={newProfile.commonlyPlaysWithProfileIds}
                  onChange={(event) =>
                    setNewProfile({
                      ...newProfile,
                      commonlyPlaysWithProfileIds: Array.from(event.target.selectedOptions).map((option) => option.value),
                      usualCompanions: Array.from(event.target.selectedOptions)
                        .map((option) => option.text)
                        .join(', ')
                    })
                  }
                  title="Commonly plays with"
                >
                  {state.profiles.map((profile) => (
                    <option key={profile.id} value={profile.id}>
                      {profile.name}
                    </option>
                  ))}
                </select>
                <button className="primary-button">
                  <Plus size={18} />
                  Add
                </button>
              </form>
              {profileFormMessage ? <p className="profile-form-message">{profileFormMessage}</p> : null}
              <section className="club-data-import" aria-labelledby="club-data-import-title">
                <strong id="club-data-import-title">Import club player data</strong>
                <p>Upload a CSV or XLSX export to add its players to this club. Orbit recognizes member number, names, contact details, membership date, preferences, and played time. SSN-related columns are not imported.</p>
                <label
                  className={`secondary-button license-file-button${isImportDropActive ? ' import-drop-active' : ''}`}
                  onDragEnter={(event) => {
                    event.preventDefault();
                    setIsImportDropActive(true);
                  }}
                  onDragOver={(event) => event.preventDefault()}
                  onDragLeave={(event) => {
                    if (event.currentTarget === event.target) setIsImportDropActive(false);
                  }}
                  onDrop={handleImportDrop}
                >
                  <Upload size={16} />
                  <span>Choose or drop CSV/XLSX</span>
                  <input
                    type="file"
                    accept=".csv,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => importProfileFile(event.target.files?.[0])}
                  />
                </label>
                {profileImportMessage ? <p className="profile-import-message" role="status">{profileImportMessage}</p> : null}
                <details className="pasted-player-import">
                  <summary>Paste player data instead</summary>
                  <textarea
                    className="import-box"
                    value={importText}
                    onChange={(event) => setImportText(event.target.value)}
                    placeholder="Paste CSV: name, preferred game, birthday, membership start, membership expiration, companions separated by |"
                  />
                  <button className="secondary-button import-button" onClick={importProfiles}>
                    Import pasted players
                  </button>
                </details>
              </section>
            </section>

            <section className="panel">
              <PanelTitle icon={<Clock />} title="Player Ledger" />
              <div className="waitlist-list">
                {state.playerLedger.slice(0, 20).map((entry) => (
                  <article className="waitlist-card" key={entry.id}>
                    <div>
                      <strong>{entry.playerName}</strong>
                      <span>{entry.type}{entry.amount !== undefined ? ` - $${entry.amount.toLocaleString()}` : ''}</span>
                      <small>{formatClock(entry.timestamp)}{entry.note ? ` - ${entry.note}` : ''}</small>
                    </div>
                  </article>
                ))}
                {!state.playerLedger.length ? <p className="muted-copy">No check-in, buy-in, or cash-out entries yet.</p> : null}
              </div>
            </section>
          </div>
        </section>
        </> : playerSection === 'requests' ? (
          <section className="profiles-layout membership-requests-layout">
            <section className="panel pending-membership-panel">
              <PanelTitle
                icon={<Bell />}
                title={`New membership requests (${pendingMembershipProfiles.length})`}
              />
              <div className="pending-membership-list">
                {pendingMembershipProfiles.map((profile) => (
                  <article className="duplicate-card" key={profile.id}>
                    <span>
                      <strong>{profile.name}</strong> · {profile.membershipPlanName || 'Membership application'}
                      {profile.membershipPriceLabel ? ` · ${profile.membershipPriceLabel}` : ''}
                      {profile.phone ? <small>{profile.phone}</small> : null}
                    </span>
                    <button className="primary-button" onClick={() => approveMembershipRequest(profile)}>Approve application</button>
                  </article>
                ))}
                {!pendingMembershipProfiles.length ? (
                  <div className="player-popup-empty">
                    <strong>No new requests</strong>
                    <span>Membership applications submitted from Orbit Player will appear here.</span>
                  </div>
                ) : null}
              </div>
            </section>

            <section className="panel pending-membership-panel approved-membership-panel">
              <PanelTitle icon={<BadgeCheck />} title={`Approved, awaiting arrival (${approvedMembershipProfiles.length})`} />
              <p className="muted-copy">ID review and payment are tracked separately. Membership activates when both requirements are complete.</p>
              <div className="pending-membership-list">
                {approvedMembershipProfiles.map((profile) => (
                  <article className="duplicate-card" key={profile.id}>
                    <span>
                      <strong>{profile.name}</strong> · {profile.membershipPlanName || (profile.membershipPlan === 'day' ? 'Day pass' : 'Monthly membership')}
                       {profile.membershipPriceLabel ? ` · ${profile.membershipPriceLabel}` : ''}
                       {profile.phone ? <small>{profile.phone}</small> : null}
                       <small>ID: {profile.identityReviewStatus ?? 'Not required'} · Payment: {profile.membershipPaymentStatus ?? 'Not required'}{profile.membershipPaymentMethod === 'app' ? ' online' : ''}</small>
                       {profile.identityReviewStatus === 'Pending' ? (
                         <small>DOB: {profile.birthday || 'Not provided'}{calculatePlayerAge(profile.birthday) != null ? ` · Age ${calculatePlayerAge(profile.birthday)}` : ''} · Address: {profile.address || 'Not provided'}</small>
                       ) : null}
                     </span>
                    <div className="duplicate-actions">
                      {profile.identityReviewStatus === 'Pending' ? (
                        <button className="primary-button" onClick={() => approvePlayerIdentity(profile)}>Approve ID</button>
                      ) : null}
                      {profile.membershipPaymentStatus === 'Pending' && profile.membershipPaymentMethod !== 'app' ? (
                        <button className="primary-button" onClick={() => markMembershipPaidInPerson(profile)}>Mark paid in person</button>
                      ) : null}
                      {profile.membershipPaymentStatus === 'Not required' &&
                      (profile.identityReviewStatus === 'Approved' || profile.identityReviewStatus === 'Not required') ? (
                        <button className="primary-button" onClick={() => markMembershipPaidInPerson(profile)}>Activate no-fee membership</button>
                      ) : null}
                      {profile.membershipPaymentStatus === 'Pending' && profile.membershipPaymentMethod === 'app' ? (
                        <small>Awaiting online payment confirmation</small>
                      ) : null}
                    </div>
                  </article>
                ))}
                {!approvedMembershipProfiles.length ? (
                  <div className="player-popup-empty">
                    <strong>No approved requests awaiting arrival</strong>
                  </div>
                ) : null}
              </div>
            </section>
          </section>
        ) : playerSection === 'archive' ? (
          <section className="panel archived-players-panel">
            <PanelTitle icon={<Archive />} title={`Past players (${archivedProfiles.length})`} />
            <p className="muted-copy">Expired memberships and archived visitors stay here with their history and saved time intact.</p>
            <div className="profile-grid archived-profile-grid">
              {archivedProfiles.map((profile) => (
                <article className="profile-card archived-profile-card" key={profile.id}>
                  <div className="profile-card-main">
                    <div className="profile-card-header">
                      <div>
                        <h3>{profile.name}</h3>
                        <p>{getMostPlayedGameName(profile)}</p>
                      </div>
                      <span className="status-pill">{profile.archivedAt ? 'Archived' : 'Expired'}</span>
                    </div>
                    <div className="profile-card-stats">
                      <span>Total <strong>{formatHours(profile.totalTimePlayedHours)}</strong></span>
                      <span>Last <strong>{formatHours(profile.lastSessionTimePlayedHours)}</strong></span>
                      <span>Saved time <strong>{profile.savedTimeCreditMinutes ?? 0} min</strong></span>
                    </div>
                    <small>Membership: {profile.membershipExpiresAt || profile.membershipExpirationDate || 'Not set'}</small>
                    {profile.archivedReason ? <small>Archive note: {profile.archivedReason}</small> : null}
                  </div>
                  {profile.archivedAt ? (
                    <div className="profile-actions">
                      <button className="secondary-button" onClick={() => restoreProfile(profile)}>
                        <ArchiveRestore size={16} /> Restore profile
                      </button>
                    </div>
                  ) : (
                    <small className="muted-copy">Renew or issue a new pass to return this player to the current directory.</small>
                  )}
                </article>
              ))}
              {!archivedProfiles.length ? <p className="muted-copy">No past players yet.</p> : null}
            </div>
          </section>
        ) : (
          <section className="panel today-players-panel">
            <div className="today-players-heading">
              <div>
                <span className="eyebrow">Daily room activity</span>
                <h2>Today's players</h2>
                <p>Everyone whose status changed today, including interest, confirmations, arrivals, and seats.</p>
              </div>
              <strong>{toLocalDateValue(new Date())}</strong>
            </div>

            <div className="today-player-summary" aria-label="Today's player status totals">
              {(['Interested', 'Confirmed Coming', 'Arrived', 'Seated'] as InterestStatus[]).map((status) => (
                <article key={status} data-status={status}>
                  <span>{status === 'Confirmed Coming' ? 'Confirmed' : status}</span>
                  <strong>{todayPlayerActivity.filter((player) => player.status === status).length}</strong>
                </article>
              ))}
            </div>

            <div className="today-player-table-head" aria-hidden="true">
              <span>Player</span>
              <span>Status</span>
              <span>Game / table</span>
              <span>Membership</span>
              <span>Updated</span>
            </div>
            <div className="today-player-list">
              {todayPlayerActivity.map((player) => (
                <article className="today-player-row" key={player.id}>
                  <div className="today-player-name">
                    <strong>{player.playerName}</strong>
                    <small>{player.profileId ? 'Saved player profile' : 'Guest / manual entry'}</small>
                  </div>
                  <span className="today-player-status" data-status={player.status}>{player.status}</span>
                  <div className="today-player-location">
                    <strong>{player.gameName}</strong>
                    <small>{player.tableLabel ? `${player.tableLabel}${player.seatNumber ? ` · Seat ${player.seatNumber}` : ''}` : 'Not seated at a table'}</small>
                  </div>
                  <span className={`today-membership ${player.activeMember ? 'active' : ''}`}>
                    {player.activeMember ? 'Active member' : 'No active membership'}
                  </span>
                  <time dateTime={player.timestamp}>{formatClock(player.timestamp)}</time>
                </article>
              ))}
              {!todayPlayerActivity.length ? (
                <div className="today-player-empty">
                  <Users size={28} />
                  <strong>No player activity today</strong>
                  <span>Interested, confirmed, arrived, and seated players will appear here automatically.</span>
                </div>
              ) : null}
            </div>
          </section>
        )}
      </main>
  );
}
