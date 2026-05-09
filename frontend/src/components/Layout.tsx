import { Link, useLocation } from 'react-router-dom';
import { Home, Scissors, Activity, History, Settings } from 'lucide-react';

const tabs = [
  { path: '/', label: 'Home', icon: Home },
  { path: '/clip', label: 'Clip', icon: Scissors },
  { path: '/jobs', label: 'Jobs', icon: Activity },
  { path: '/history', label: 'History', icon: History },
  { path: '/settings', label: 'Settings', icon: Settings },
];

export default function Layout({ children }: { children: React.ReactNode }) {
  const location = useLocation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ borderBottom: '1px solid #e5e7eb', background: '#fff' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', height: 56, gap: 24 }}>
            <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
              <Scissors size={22} /> VClipper
            </h1>
            <nav style={{ display: 'flex', gap: 4 }}>
              {tabs.map((t) => {
                const active = location.pathname === t.path;
                return (
                  <Link
                    key={t.path}
                    to={t.path}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '8px 14px',
                      borderRadius: 6,
                      textDecoration: 'none',
                      fontSize: 14,
                      fontWeight: 500,
                      color: active ? '#111' : '#6b7280',
                      background: active ? '#f3f4f6' : 'transparent',
                    }}
                  >
                    <t.icon size={16} />
                    {t.label}
                  </Link>
                );
              })}
            </nav>
          </div>
        </div>
      </header>
      <main style={{ flex: 1, overflow: 'auto', background: '#f9fafb' }}>
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: 24 }}>{children}</div>
      </main>
    </div>
  );
}
