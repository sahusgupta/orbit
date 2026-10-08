import { Command } from 'cmdk';
import { Search } from 'lucide-react';

export type ShellCommand = { id: string; label: string; group?: string; keywords?: string; action: () => void };

type CommandPaletteProps = {
  commands: ShellCommand[];
  onSelect: (command: ShellCommand) => void;
};

export default function CommandPalette({ commands, onSelect }: CommandPaletteProps) {
  return (
    <Command label="Orbit command palette">
      <div className="command-input-row">
        <Search size={18} />
        <Command.Input autoFocus placeholder="Search players, tables, actions…" />
      </div>
      <Command.List>
        <Command.Empty>No matching command.</Command.Empty>
        {Array.from(new Set(commands.map((item) => item.group || 'Actions'))).map((group) => (
          <Command.Group key={group} heading={group}>
            {commands.filter((item) => (item.group || 'Actions') === group).map((item) => (
              <Command.Item key={item.id} keywords={item.keywords?.split(' ')} onSelect={() => onSelect(item)}>
                {item.label}
              </Command.Item>
            ))}
          </Command.Group>
        ))}
      </Command.List>
    </Command>
  );
}
