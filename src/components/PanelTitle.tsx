import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

export default function PanelTitle({
  icon,
  title,
  collapsed,
  onToggle
}: {
  icon: ReactNode;
  title: string;
  collapsed?: boolean;
  onToggle?: () => void;
}) {
  return (
    <div className="panel-title">
      <div className="panel-title-main">
        {icon}
        <h2>{title}</h2>
      </div>
      {onToggle ? (
        <button className="icon-button panel-toggle-button" onClick={onToggle} title={collapsed ? `Open ${title}` : `Close ${title}`}>
          {collapsed ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
        </button>
      ) : null}
    </div>
  );
}
