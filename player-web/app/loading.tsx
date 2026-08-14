import { SkeletonList } from '@/src/components/ui/state-panels';

export default function Loading() {
  return <div className="page-shell"><div className="page-intro page-intro--loading"><span /><span /></div><SkeletonList rows={4} /></div>;
}
