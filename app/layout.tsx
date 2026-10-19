import './globals.css';
import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import { AuthProvider } from '@/lib/auth-context';
import { WorkspaceProvider } from '@/lib/workspace-context';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'RelayGate — AI Reliability Gateway',
  description:
    'One API. Multiple AI providers. Automatic failover. Connect your own OpenAI, Anthropic, and Gemini keys and route production traffic with confidence.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <AuthProvider>
          <WorkspaceProvider>{children}</WorkspaceProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
