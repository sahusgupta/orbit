import { Download, FileText, KeyRound, Moon, Plus, Settings, Trash2, Upload, Users, X } from 'lucide-react';
import type { Dispatch, FormEvent, SetStateAction } from 'react';
import PanelTitle from './PanelTitle';
import { getCollectionProfile } from '../domain/reporting';
import type { AppState, ClubAccount, CollectionProfile, TableCap } from '../domain/types';
import type {
  BackendStatus,
  SaveStatus,
  SettingsSection,
  StaffDraft
} from '../features/settings/settingsWorkspace';
const tableCaps = [6, 8, 10] as const satisfies readonly TableCap[];

type SettingsViewProps = {
  state: AppState;
  settingsSection: SettingsSection;
  clubDraft: ClubAccount;
  staffDraft: StaffDraft;
  pilotKeyError: string;
  backendStatus: BackendStatus | null;
  saveStatus: SaveStatus;
  backupMessage: string;
  reportMessage: string;
  closeRoute: () => void;
  applyReplacementPilotKey: (file?: File) => Promise<void>;
  saveClubAccount: (event: FormEvent) => void;
  updateSettings: (patch: Partial<AppState['settings']>) => void;
  selectActiveStaff: (staffId: string) => void;
  addStaffAccount: (event: FormEvent) => Promise<void>;
  formatClock: (iso?: string) => string;
  deactivateStaffAccount: (staffId: string) => void;
  exportJson: () => void;
  importBackupFile: (file?: File) => Promise<void>;
  submitAnalyticalReport: () => Promise<void>;
  exportPilotReport: () => void;
  applyDefaultCollectionToActiveTables: () => void;
  updateDefaultTableCap: (cap: TableCap) => void;
  updateCollectionProfile: (gameId: string, patch: Partial<CollectionProfile>) => void;
  setBackendStatus: Dispatch<SetStateAction<BackendStatus | null>>;
  setClubDraft: Dispatch<SetStateAction<ClubAccount>>;
  setSettingsSection: Dispatch<SetStateAction<SettingsSection>>;
  setStaffDraft: Dispatch<SetStateAction<StaffDraft>>;
};

export default function SettingsView({
  state,
  settingsSection,
  clubDraft,
  staffDraft,
  pilotKeyError,
  backendStatus,
  saveStatus,
  backupMessage,
  reportMessage,
  closeRoute,
  applyReplacementPilotKey,
  saveClubAccount,
  updateSettings,
  selectActiveStaff,
  addStaffAccount,
  formatClock,
  deactivateStaffAccount,
  exportJson,
  importBackupFile,
  submitAnalyticalReport,
  exportPilotReport,
  applyDefaultCollectionToActiveTables,
  updateDefaultTableCap,
  updateCollectionProfile,
  setBackendStatus,
  setClubDraft,
  setSettingsSection,
  setStaffDraft
}: SettingsViewProps) {
  return (
      <main className={`app-shell compact-shell settings-page settings-view-${settingsSection}`}>
        <header className="topbar">
          <div>
            <h1>Settings</h1>
            <p className="page-subtitle">Club, staff, tables, data, display, and legal information</p>
          </div>
          <button className="ghost-button" onClick={closeRoute}>
            <X size={18} />
            Close
          </button>
        </header>

        <nav className="settings-nav" aria-label="Settings sections">
          <button className={settingsSection === 'club' ? 'active' : ''} onClick={() => setSettingsSection('club')}>Club & license</button><button className={settingsSection === 'staff' ? 'active' : ''} onClick={() => setSettingsSection('staff')}>Staff</button><button className={settingsSection === 'tables' ? 'active' : ''} onClick={() => setSettingsSection('tables')}>Tables & fees</button><button className={settingsSection === 'data' ? 'active' : ''} onClick={() => setSettingsSection('data')}>Data</button><button className={settingsSection === 'display' ? 'active' : ''} onClick={() => setSettingsSection('display')}>Display</button><button className={settingsSection === 'legal' ? 'active' : ''} onClick={() => setSettingsSection('legal')}>Legal & support</button>
        </nav>
        <section className="customization-layout">
          <section className="panel settings-panel account-management-panel" id="settings-club">
            <PanelTitle icon={<KeyRound />} title="Account & License" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>{state.settings.clubAccount?.clubName || 'Club account'}</strong>
                  <span>
                    {state.settings.pilotAccess
                      ? `License ${state.settings.pilotAccess.licenseId || state.settings.pilotAccess.authorizationCode} expires ${state.settings.pilotAccess.expiresAt}`
                      : 'No active license on file'}
                  </span>
                </div>
                <label className="secondary-button license-file-button">
                  Renew Key
                  <input
                    type="file"
                    accept="application/json,.json,.key"
                    onChange={(event) => applyReplacementPilotKey(event.target.files?.[0])}
                  />
                </label>
              </article>
              <form className="account-management-form" onSubmit={saveClubAccount}>
                <input
                  value={clubDraft.clubName}
                  onChange={(event) => setClubDraft({ ...clubDraft, clubName: event.target.value })}
                  placeholder="Club name"
                />
                <input
                  value={clubDraft.accountName}
                  onChange={(event) => setClubDraft({ ...clubDraft, accountName: event.target.value })}
                  placeholder="Account name"
                />
                <input
                  value={clubDraft.contactName}
                  onChange={(event) => setClubDraft({ ...clubDraft, contactName: event.target.value })}
                  placeholder="Primary contact"
                />
                <input
                  type="email"
                  value={clubDraft.email}
                  onChange={(event) => setClubDraft({ ...clubDraft, email: event.target.value })}
                  placeholder="Email"
                />
                <input
                  value={clubDraft.phone}
                  onChange={(event) => setClubDraft({ ...clubDraft, phone: event.target.value })}
                  placeholder="Phone"
                />
                <input
                  value={clubDraft.address}
                  onChange={(event) => setClubDraft({ ...clubDraft, address: event.target.value })}
                  placeholder="Address"
                />
                <button className="primary-button" type="submit">
                  Save Account
                </button>
              </form>
              <article className="preference-row membership-plan-heading">
                <div><strong>Player memberships</strong><span>Create the plans published to Orbit Player. Purchases become club memberships and unlock game requests.</span></div>
                <button className="secondary-button" type="button" onClick={() => updateSettings({ membershipPlans: [...state.settings.membershipPlans, { id: `plan-${Date.now()}`, name: 'New Membership', priceLabel: '$0', durationDays: 30, description: '', active: true }] })}><Plus size={16} /> Add plan</button>
              </article>
              <div className="preference-list">
                {state.settings.membershipPlans.map((plan) => (
                  <article className="preference-row" key={plan.id}>
                    <div className="account-management-form">
                      <input value={plan.name} aria-label="Membership name" placeholder="Membership name" onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, name: event.target.value } : item) })} />
                      <input value={plan.priceLabel} aria-label="Membership price" placeholder="$40/mo" onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, priceLabel: event.target.value } : item) })} />
                      <input type="number" min="1" value={plan.durationDays} aria-label="Membership duration in days" onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, durationDays: Math.max(1, Number(event.target.value) || 1) } : item) })} />
                      <input value={plan.description ?? ''} aria-label="Membership description" placeholder="What this plan includes" onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, description: event.target.value } : item) })} />
                    </div>
                    <label><input type="checkbox" checked={plan.active} onChange={(event) => updateSettings({ membershipPlans: state.settings.membershipPlans.map((item) => item.id === plan.id ? { ...item, active: event.target.checked } : item) })} /> Published</label>
                    <button className="icon-button" type="button" aria-label={`Delete ${plan.name}`} onClick={() => updateSettings({ membershipPlans: state.settings.membershipPlans.filter((item) => item.id !== plan.id) })}><Trash2 size={16} /></button>
                  </article>
                ))}
              </div>
              {pilotKeyError ? <p className="access-error">{pilotKeyError}</p> : null}
            </div>
          </section>

          <section className="panel settings-panel" id="settings-staff">
            <PanelTitle icon={<Users />} title="Staff Accounts" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>Active operator</strong>
                  <span>Select the staff account using this station tonight.</span>
                </div>
                <select
                  value={state.settings.activeStaffId ?? ''}
                  onChange={(event) => selectActiveStaff(event.target.value)}
                >
                  <option value="">No operator selected</option>
                  {state.settings.staffAccounts.filter((staff) => staff.active).map((staff) => (
                    <option key={staff.id} value={staff.id}>
                      {staff.name} - {staff.role}
                    </option>
                  ))}
                </select>
              </article>
              <form className="staff-account-form" onSubmit={addStaffAccount}>
                <input
                  value={staffDraft.name}
                  onChange={(event) => setStaffDraft({ ...staffDraft, name: event.target.value })}
                  placeholder="Staff name"
                />
                <select
                  value={staffDraft.role}
                  onChange={(event) => setStaffDraft({ ...staffDraft, role: event.target.value as StaffDraft['role'] })}
                >
                  <option value="Floor">Floor</option>
                  <option value="Manager">Manager</option>
                  <option value="Owner">Owner</option>
                </select>
                <input
                  value={staffDraft.pin}
                  onChange={(event) => setStaffDraft({ ...staffDraft, pin: event.target.value })}
                  placeholder="PIN"
                  type="password"
                  inputMode="numeric"
                />
                <button className="secondary-button" type="submit">
                  Add Staff
                </button>
              </form>
              {state.settings.staffAccounts.length ? (
                <div className="staff-account-list">
                  {state.settings.staffAccounts.map((staff) => (
                    <article className={staff.active ? 'staff-account-row' : 'staff-account-row inactive'} key={staff.id}>
                      <div>
                        <strong>{staff.name}</strong>
                        <span>{staff.role} {staff.lastSelectedAt ? `- last selected ${formatClock(staff.lastSelectedAt)}` : ''}</span>
                      </div>
                      {staff.active ? (
                        <button aria-label={`Deactivate ${staff.name}`} className="icon-button danger" onClick={() => deactivateStaffAccount(staff.id)} title="Deactivate staff account">
                          <X size={16} />
                        </button>
                      ) : (
                        <span>Inactive</span>
                      )}
                    </article>
                  ))}
                </div>
              ) : (
                <span className="muted-copy">No staff accounts yet.</span>
              )}
            </div>
          </section>

          <section className="panel settings-panel" id="settings-data">
            <PanelTitle icon={<Download />} title="Data Safety" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>Backup room data</strong>
                  <span>Export a full local backup with tables, profiles, settings, account details, logs, and history.</span>
                </div>
                <button className="secondary-button" onClick={exportJson}>
                  <Download size={16} />
                  Export Backup
                </button>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Restore from backup</strong>
                  <span>Import an Orbit backup file after confirming it should replace this installation's local state.</span>
                </div>
                <label className="secondary-button license-file-button">
                  <Upload size={16} />
                  Restore
                  <input
                    type="file"
                    accept="application/json,.json"
                    onChange={(event) => importBackupFile(event.target.files?.[0])}
                  />
                </label>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Detailed pilot report</strong>
                  <span>Export account, operational, staff usage, feature frequency, recent events, and feedback analytics.</span>
                </div>
                <div className="inline-actions">
                  <button className="secondary-button" onClick={submitAnalyticalReport}>
                    <Upload size={16} />
                    Submit
                  </button>
                  <button className="secondary-button" onClick={exportPilotReport}>
                    <Download size={16} />
                    Export
                  </button>
                </div>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Embedded backend</strong>
                  <span>
                    {backendStatus?.running
                      ? `Running on ${backendStatus.host}:${backendStatus.port} with ${backendStatus.reportCount} stored report${backendStatus.reportCount === 1 ? '' : 's'}`
                      : 'Starting with the desktop app'}
                  </span>
                </div>
                <button
                  className="secondary-button"
                  onClick={() => window.tableManagerDesktop?.getBackendStatus().then((status) => setBackendStatus(status))}
                >
                  Refresh
                </button>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Save status</strong>
                  <span>{saveStatus.message}</span>
                </div>
                <span className={`save-status ${saveStatus.state}`}>{saveStatus.state}</span>
              </article>
              {backupMessage ? <p className={backupMessage.includes('Backup') ? 'success-copy' : 'access-error'}>{backupMessage}</p> : null}
              {reportMessage ? <p className={reportMessage.includes('failed') ? 'access-error' : 'success-copy'}>{reportMessage}</p> : null}
            </div>
          </section>

          <section className="panel settings-panel" id="settings-tables">
            <PanelTitle icon={<Settings />} title="Table Defaults" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>New table fee model</strong>
                  <span>Choose whether newly created tables use drop collection or player time fees.</span>
                </div>
                <div className="segmented-control">
                  <button
                    className={state.settings.defaultCollectionMode === 'Drop' ? 'secondary-button active' : 'ghost-button'}
                    onClick={() => updateSettings({ defaultCollectionMode: 'Drop' })}
                  >
                    Drop
                  </button>
                  <button
                    className={state.settings.defaultCollectionMode === 'Time' ? 'secondary-button active' : 'ghost-button'}
                    onClick={() => updateSettings({ defaultCollectionMode: 'Time' })}
                  >
                    Time fees
                  </button>
                </div>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Apply default to active tables</strong>
                  <span>Update every open table and seated player timer setting to the selected collection mode.</span>
                </div>
                <button className="secondary-button" onClick={applyDefaultCollectionToActiveTables}>
                  Apply
                </button>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Table cap</strong>
                  <span>Use a standard table size for new and open tables. Caps are limited to 6, 8, or 10 seats.</span>
                </div>
                <div className="segmented-control">
                  {tableCaps.map((cap) => (
                    <button
                      key={cap}
                      className={state.settings.defaultTableCap === cap ? 'secondary-button active' : 'ghost-button'}
                      onClick={() => updateDefaultTableCap(cap)}
                    >
                      {cap}
                    </button>
                  ))}
                </div>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Default hourly fee</strong>
                  <span>Used for time-fee games where players pay by the hour.</span>
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={state.settings.defaultHourlyFee}
                  onChange={(event) => updateSettings({ defaultHourlyFee: Number(event.target.value) })}
                />
              </article>
              <article className="preference-row">
                <div>
                  <strong>Default drop estimate</strong>
                  <span>Estimated money removed from drop tables per occupied seat-hour when no actual drop is logged.</span>
                </div>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={state.settings.defaultEstimatedDropPerSeatHour}
                  onChange={(event) => updateSettings({ defaultEstimatedDropPerSeatHour: Number(event.target.value) })}
                />
              </article>
              {state.games.map((game) => {
                const collectionProfile = getCollectionProfile(state, game.id);
                return (
                  <article className="preference-row collection-profile-row" key={game.id}>
                    <div>
                      <strong>{game.name} collection profile</strong>
                      <span>{collectionProfile.collectionMode === 'Time' ? 'Hourly fee model' : 'Money removed from table model'}</span>
                    </div>
                    <div className="segmented-control collection-profile-control">
                      <button
                        className={collectionProfile.collectionMode === 'Drop' ? 'secondary-button active' : 'ghost-button'}
                        onClick={() => updateCollectionProfile(game.id, { collectionMode: 'Drop' })}
                      >
                        Drop
                      </button>
                      <button
                        className={collectionProfile.collectionMode === 'Time' ? 'secondary-button active' : 'ghost-button'}
                        onClick={() => updateCollectionProfile(game.id, { collectionMode: 'Time' })}
                      >
                        Time
                      </button>
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={collectionProfile.hourlyFee}
                        onChange={(event) => updateCollectionProfile(game.id, { hourlyFee: Number(event.target.value) })}
                        title="Hourly fee"
                      />
                      <input
                        type="number"
                        min="0"
                        step="1"
                        value={collectionProfile.estimatedDropPerSeatHour}
                        onChange={(event) => updateCollectionProfile(game.id, { estimatedDropPerSeatHour: Number(event.target.value) })}
                        title="Estimated drop per occupied seat-hour"
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section className="panel settings-panel" id="settings-display">
            <PanelTitle icon={<Moon />} title="Display" />
            <div className="preference-list">
              <article className="preference-row">
                <div>
                  <strong>Dark mode</strong>
                  <span>Use the lower-brightness theme for the floor, pop-outs, and summaries.</span>
                </div>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={state.settings.lowLight}
                    onChange={(event) => updateSettings({ lowLight: event.target.checked })}
                  />
                  <span>{state.settings.lowLight ? 'On' : 'Off'}</span>
                </label>
              </article>
              <article className="preference-row">
                <div>
                  <strong>Recent player shortcuts</strong>
                  <span>Show quick-fill buttons below Quick Add on the landing page.</span>
                </div>
                <label className="switch-control">
                  <input
                    type="checkbox"
                    checked={state.settings.showRecentPlayers}
                    onChange={(event) => updateSettings({ showRecentPlayers: event.target.checked })}
                  />
                  <span>{state.settings.showRecentPlayers ? 'Shown' : 'Hidden'}</span>
                </label>
              </article>
            </div>
          </section>

          <section className="panel settings-panel" id="settings-legal">
            <PanelTitle icon={<FileText />} title="Legal & Support" />
            <div className="preference-list">
              <article className="preference-row">
                <div><strong>Privacy Policy</strong><span>Read how Orbit collects, uses, discloses, and retains personal data.</span></div>
                <a className="secondary-button" href="https://orbitapp-one.vercel.app/privacy" target="_blank" rel="noreferrer">Read policy</a>
              </article>
              <article className="preference-row">
                <div><strong>Terms of Service</strong><span>Read the terms that govern Orbit websites, software, apps, events, APIs, and related services.</span></div>
                <a className="secondary-button" href="https://orbitapp-one.vercel.app/terms" target="_blank" rel="noreferrer">Read terms</a>
              </article>
              <article className="preference-row">
                <div><strong>Support</strong><span>Contact Orbit for account, installation, or operating assistance.</span></div>
                <a className="secondary-button" href="https://orbitapp-one.vercel.app/support" target="_blank" rel="noreferrer">Open support</a>
              </article>
            </div>
          </section>
        </section>
      </main>
  );
}
