import React from 'react';
import { Pressable, Text, View } from 'react-native';
import PlayerApp from './src/PlayerApp';

type State = { failed: boolean; incidentId: string };

class PlayerRecoveryBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false, incidentId: '' };

  static getDerivedStateFromError(): State {
    return {
      failed: true,
      incidentId: `orbit-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
    };
  }

  componentDidCatch(error: Error) {
    console.error('[orbit-player-render-incident]', {
      incidentId: this.state.incidentId,
      errorName: error.name || 'Error'
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View accessibilityRole="alert" style={{ flex: 1, justifyContent: 'center', padding: 28, gap: 14, backgroundColor: '#f6f7f9' }}>
        <Text accessibilityRole="header" style={{ color: '#111827', fontSize: 24, fontWeight: '700' }}>Orbit Player needs to recover.</Text>
        <Text style={{ color: '#4b5563', fontSize: 16 }}>Your account was not deleted. Retry the app view; if this repeats, share the incident reference with support.</Text>
        <Text style={{ color: '#6b7280', fontFamily: 'monospace' }}>Incident {this.state.incidentId}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => this.setState({ failed: false, incidentId: '' })}
          style={{ alignSelf: 'flex-start', borderRadius: 8, backgroundColor: '#2737d8', paddingHorizontal: 18, paddingVertical: 12 }}
        >
          <Text style={{ color: '#ffffff', fontWeight: '700' }}>Retry view</Text>
        </Pressable>
      </View>
    );
  }
}

export default function App() {
  return <PlayerRecoveryBoundary><PlayerApp /></PlayerRecoveryBoundary>;
}
