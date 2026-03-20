import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/charts/styles.css';
import { cookies } from 'next/headers';
import { AppProviders } from '@/components/AppProviders';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const cookieStore = await cookies();
  const colorScheme = (cookieStore.get('mantine-color-scheme')?.value ?? 'auto') as 'light' | 'dark' | 'auto';

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Call Attendant</title>
      </head>
      <body suppressHydrationWarning>
        <AppProviders colorScheme={colorScheme}>{children}</AppProviders>
      </body>
    </html>
  );
}
