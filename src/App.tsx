import { useState } from 'react';
import type { Credentials } from './api';
import Login from './components/Login';
import ChatApp from './components/ChatApp';

export default function App() {
  const [credentials, setCredentials] = useState<Credentials | null>(null);
  return credentials ? (
    <ChatApp credentials={credentials} onLogout={() => setCredentials(null)} />
  ) : (
    <Login onConnect={setCredentials} />
  );
}
