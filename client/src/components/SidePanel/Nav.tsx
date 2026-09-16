import type { NavLink } from '~/common';
import { useActivePanel, resolveActivePanel } from '~/Providers';
import { useGetStartupConfig } from '~/data-provider';
import { useLocalize } from '~/hooks';

export default function Nav({ links }: { links: NavLink[] }) {
  const localize = useLocalize();
  const { data: startupConfig } = useGetStartupConfig();
  const { active } = useActivePanel();
  const effectiveActive = resolveActivePanel(active, links);
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overflow-x-hidden text-text-primary">
      <div className="flex h-12 flex-shrink-0 items-center border-b border-border-light px-3">
        <img
          src="/assets/logo.svg"
          className="h-6 w-auto object-contain"
          alt={localize('com_ui_logo', { 0: startupConfig?.appTitle ?? 'LibreChat' })}
        />
      </div>
      {links.map((link) =>
        link.id === effectiveActive && link.Component ? <link.Component key={link.id} /> : null,
      )}
    </div>
  );
}
