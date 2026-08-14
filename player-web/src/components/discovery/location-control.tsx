'use client';

import { Form } from '@base-ui/react/form';
import { Input } from '@base-ui/react/input';
import { LocateFixed, MapPin } from 'lucide-react';
import { useState } from 'react';
import { useLocation } from '@/src/location/location-context';
import { Button } from '@/src/components/ui/button';

export function LocationControl() {
  const { status, label, requestLocation, setManualLocation } = useLocation();
  const [manual, setManual] = useState('');
  return (
    <div className="location-control">
      <div className="location-control__status"><MapPin aria-hidden="true" size={17} /><span>{label}</span></div>
      <Button size="compact" tone="quiet" onClick={requestLocation} disabled={status === 'requesting'}>
        <LocateFixed aria-hidden="true" size={16} />{status === 'requesting' ? 'Locating…' : 'Use my location'}
      </Button>
      <Form onFormSubmit={() => setManualLocation(manual)}>
        <label className="sr-only" htmlFor="manual-location">City or area</label>
        <Input id="manual-location" name="manualLocation" value={manual} onChange={(event) => setManual(event.target.value)} placeholder="City or area" />
        <Button size="compact" tone="secondary" type="submit">Set area</Button>
      </Form>
    </div>
  );
}
