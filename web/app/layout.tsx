import './globals.css';
import type { Metadata } from 'next';

const VERSION = process.env.NEXT_PUBLIC_JJPLAN_VERSION ?? 'dev';

export const metadata: Metadata = {
  title: 'JJ',
  description: 'jjplan dashboard',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        <div className="fixed bottom-2 right-3 text-xs font-mono text-zinc-400 select-none pointer-events-none">
          v{VERSION}
        </div>
      </body>
    </html>
  );
}
