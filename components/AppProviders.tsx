'use client';

import { useState, useEffect } from 'react';
import { MantineProvider, AppShell, NavLink, Group, Text, Badge, ActionIcon, Tooltip, useMantineColorScheme, Burger } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { MantineColorSchemeManager, MantineColorScheme } from '@mantine/core';
import { IconPhone, IconLayoutDashboard, IconPhoneCall, IconRecordMail, IconAddressBook, IconBan, IconSettings, IconBug, IconSun, IconMoon, IconDeviceDesktop, IconStethoscope } from '@tabler/icons-react';
import { Notifications } from '@mantine/notifications';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { CallNotification } from '@/components/CallNotification';
import { apiClient } from '@/lib/api-client';

const COOKIE_KEY = 'mantine-color-scheme';

function cookieColorSchemeManager(): MantineColorSchemeManager {
  return {
    get: (defaultValue) => {
      if (typeof document === 'undefined') return defaultValue;
      const match = document.cookie.match(new RegExp(`(?:^|; )${COOKIE_KEY}=([^;]*)`));
      const value = match ? decodeURIComponent(match[1]!) : null;
      return (value === 'light' || value === 'dark' || value === 'auto') ? value : defaultValue;
    },
    set: (value) => {
      document.cookie = `${COOKIE_KEY}=${encodeURIComponent(value)};path=/;max-age=${60 * 60 * 24 * 365}`;
    },
    subscribe: () => {},
    unsubscribe: () => {},
    clear: () => {
      document.cookie = `${COOKIE_KEY}=;path=/;max-age=0`;
    },
  };
}

const colorSchemeManager = cookieColorSchemeManager();

function ThemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  return (
    <Group gap={4} p="xs">
      <Tooltip label="Light" position="right">
        <ActionIcon
          variant={colorScheme === 'light' ? 'filled' : 'subtle'}
          size="sm"
          onClick={() => setColorScheme('light')}
          aria-label="Light theme"
        >
          <IconSun size={14} stroke={1.5} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="System" position="right">
        <ActionIcon
          variant={colorScheme === 'auto' ? 'filled' : 'subtle'}
          size="sm"
          onClick={() => setColorScheme('auto')}
          aria-label="System theme"
        >
          <IconDeviceDesktop size={14} stroke={1.5} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label="Dark" position="right">
        <ActionIcon
          variant={colorScheme === 'dark' ? 'filled' : 'subtle'}
          size="sm"
          onClick={() => setColorScheme('dark')}
          aria-label="Dark theme"
        >
          <IconMoon size={14} stroke={1.5} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

export function AppProviders({ children, colorScheme }: { children: React.ReactNode; colorScheme: 'light' | 'dark' | 'auto' }) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);
  const [debugConsole, setDebugConsole] = useState(false);
  const [diagnosticMode, setDiagnosticMode] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [opened, { toggle, close }] = useDisclosure();

  useEffect(() => {
    setMounted(true);
    apiClient.messages.unread().then(d => setUnreadCount(d.count));

    const fetchDebugConsole = () =>
      apiClient.settings.get().then(s => {
        setDebugConsole(s.debugConsole);
        setDiagnosticMode(s.diagnosticMode);
      }).catch(() => {});
    fetchDebugConsole();
    window.addEventListener('settings-saved', fetchDebugConsole);

    const evtSource = new EventSource('/api/events');
    evtSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { type: string };
        if (data.type === 'new-voicemail')    setUnreadCount(c => c + 1);
        if (data.type === 'voicemail-new')    setUnreadCount(c => c + 1);
        if (data.type === 'voicemail-played') setUnreadCount(c => Math.max(0, c - 1));
      } catch { /* ignore */ }
    };
    evtSource.onerror = () => {};
    return () => {
      window.removeEventListener('settings-saved', fetchDebugConsole);
      evtSource.close();
    };
  }, []);

  const navItems = [
    { href: '/',          label: 'Dashboard',    icon: IconLayoutDashboard },
    { href: '/calls',     label: 'Call Log',     icon: IconPhoneCall },
    { href: '/messages',  label: 'Voicemails',   icon: IconRecordMail, badge: unreadCount || undefined },
    { href: '/whitelist', label: 'Phonebook',    icon: IconAddressBook },
    { href: '/blacklist', label: 'Blocklist',    icon: IconBan },
    { href: '/settings',    label: 'Settings',      icon: IconSettings },
    ...(debugConsole ? [{ href: '/debug', label: 'Debug Console', icon: IconBug }] : []),
    ...(diagnosticMode ? [{ href: '/diagnostic', label: 'Diagnostics', icon: IconStethoscope }] : []),
  ];

  return (
    <MantineProvider colorSchemeManager={colorSchemeManager} defaultColorScheme={colorScheme}>
      <Notifications position="top-right" />
      <CallNotification />
      <AppShell
        navbar={{ width: 200, breakpoint: 'sm', collapsed: { mobile: !opened } }}
        header={{ height: { base: 50, sm: 0 } }}
        padding="md"
      >
        <AppShell.Header hiddenFrom="sm">
          <Group h="100%" px="sm" gap="sm">
            <Burger opened={opened} onClick={toggle} size="sm" aria-label="Toggle navigation" />
            <IconPhone size={20} stroke={1.5} />
            <Text fw={700} size="md">Call Attendant</Text>
          </Group>
        </AppShell.Header>

        <AppShell.Navbar p="xs" style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ flex: 1 }}>
            <Group mb="md" p="xs" gap="xs" wrap="nowrap">
              <IconPhone size={22} stroke={1.5} style={{ flexShrink: 0 }} />
              <Text fw={700} size="lg">Call Attendant</Text>
            </Group>
            {navItems.map((item) => (
              <NavLink
                key={item.href}
                component={Link}
                href={item.href}
                label={item.label}
                active={pathname === item.href}
                leftSection={mounted ? <item.icon size={18} stroke={1.5} /> : undefined}
                rightSection={
                  item.badge ? (
                    <Badge size="sm" color="blue">{item.badge > 999 ? '999+' : item.badge}</Badge>
                  ) : undefined
                }
                onClick={close}
              />
            ))}
          </div>
          <ThemeToggle />
        </AppShell.Navbar>
        <AppShell.Main>{children}</AppShell.Main>
      </AppShell>
    </MantineProvider>
  );
}
