import React from 'react';

type RecoveryBoundaryProps = {
  children: React.ReactNode;
  label: string;
  onIncident?: (incidentId: string) => void;
};

type RecoveryBoundaryState = { incidentId: string; failed: boolean };

const createIncidentId = () => `orbit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export class RecoveryBoundary extends React.Component<RecoveryBoundaryProps, RecoveryBoundaryState> {
  state: RecoveryBoundaryState = { failed: false, incidentId: '' };

  static getDerivedStateFromError(): RecoveryBoundaryState {
    return { failed: true, incidentId: createIncidentId() };
  }

  componentDidCatch(error: Error): void {
    console.error('[orbit-render-incident]', {
      incidentId: this.state.incidentId,
      errorName: error.name || 'Error'
    });
    this.props.onIncident?.(this.state.incidentId);
  }

  private retry = () => this.setState({ failed: false, incidentId: '' });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="recovery-state" role="alert" aria-labelledby="recovery-title">
        <p className="eyebrow">Orbit recovery</p>
        <h1 id="recovery-title">{this.props.label} could not be displayed.</h1>
        <p>Your saved operations were not discarded. Retry this view, or restart Orbit if the problem continues.</p>
        <p className="recovery-incident">Incident {this.state.incidentId}</p>
        <div className="recovery-actions">
          <button type="button" onClick={this.retry}>Retry view</button>
          <button type="button" className="secondary-button" onClick={() => window.location.reload()}>Restart Orbit</button>
        </div>
      </main>
    );
  }
}
