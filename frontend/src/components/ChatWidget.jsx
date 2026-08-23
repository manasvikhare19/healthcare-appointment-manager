import React, { useEffect, useRef, useState } from 'react';
import { CircleHelp, MessageCircle, Send, Sparkles, X } from 'lucide-react';
import api from '../api/client';
import { useAuth } from '../context/AuthContext.jsx';

const GREETING = {
  PATIENT: "I'm here to make your care journey easier. Ask me about appointments, doctors, or anything about the clinic.",
  DOCTOR: "Hello Doctor. Ask me about today's triage queue, high priority patients, or schedule management.",
  ADMIN: "Hello Admin. Ask me about clinic stats, doctor leave, or email notification logs.",
};

export default function ChatWidget() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef(null);

  useEffect(() => {
    if (open && messages.length === 0 && user) {
      setMessages([
        {
          from: 'bot',
          text: GREETING[user.role] || "I'm here to help you navigate Meridian Clinic.",
          quickReplies: defaultQuickReplies(user.role),
        },
      ]);
    }
  }, [open, user]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  if (!user) return null;

  function defaultQuickReplies(role) {
    if (role === 'PATIENT') return ['Show my appointments', 'Find a doctor', 'What do urgency levels mean?'];
    if (role === 'DOCTOR') return ["Show today's queue", 'How many high priority today?', 'What do urgency levels mean?'];
    if (role === 'ADMIN') return ['Who is on leave today?', 'How many appointments today?'];
    return [];
  }

  async function send(text) {
    const trimmed = (text ?? input).trim();
    if (!trimmed || loading) return;
    setMessages((prev) => [...prev, { from: 'user', text: trimmed }]);
    setInput('');
    setLoading(true);
    try {
      const { data } = await api.post('/assistant/message', { message: trimmed });
      setMessages((prev) => [...prev, { from: 'bot', text: data.reply, quickReplies: data.quickReplies || [] }]);
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { from: 'bot', text: "I couldn't reach the assistant just now. Please try again.", quickReplies: [] },
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {!open && (
        <button className="chat-fab" onClick={() => setOpen(true)} aria-label="Ask our AI">
          <MessageCircle size={19} />
          <span>Ask our AI</span>
        </button>
      )}

      {open && (
        <aside className="chat-panel fade-in" aria-label="Clinic Assistant">
          <div className="chat-header">
            <div className="assistant-avatar" style={{ display: 'grid', placeItems: 'center', width: 32, height: 32, borderRadius: 10, background: 'rgba(255,255,255,0.16)' }}>
              <Sparkles size={17} />
            </div>
            <div>
              <strong style={{ display: 'block', fontSize: 14, color: '#fff' }}>Clinic Assistant</strong>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: '#b9dcd5' }}>
                {user.role.charAt(0) + user.role.slice(1).toLowerCase()} helper
                <i style={{ width: 6, height: 6, borderRadius: '50%', background: '#74d5bd', display: 'inline-block' }} />
              </span>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close assistant"
              style={{ marginLeft: 'auto', display: 'grid', placeItems: 'center', width: 28, height: 28, color: '#fff', border: 0, borderRadius: '50%', background: 'rgba(255,255,255,0.15)', cursor: 'pointer' }}
            >
              <X size={17} />
            </button>
          </div>

          <div className="chat-messages" ref={scrollRef}>
            {messages.map((m, i) => (
              <div key={i} className={`chat-bubble-row ${m.from}`}>
                <div className={`chat-bubble ${m.from}`}>
                  {m.text.split('\n').map((line, j) => (
                    <p key={j} style={{ margin: j === 0 ? 0 : '4px 0 0' }}>{line}</p>
                  ))}
                </div>
                {m.from === 'bot' && m.quickReplies?.length > 0 && (
                  <div className="chat-quick-replies">
                    {m.quickReplies.map((q, k) => (
                      <button key={k} className="chat-chip" onClick={() => send(q)} disabled={loading}>
                        {q}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="chat-bubble-row bot">
                <div className="chat-bubble bot" style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '10px 14px' }}>
                  <span className="spinner" style={{ width: 14, height: 14, borderColor: 'var(--teal-700)', borderTopColor: 'transparent' }} />
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>Thinking…</span>
                </div>
              </div>
            )}
          </div>

          <form
            className="chat-input-row"
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask something…"
              maxLength={500}
            />
            <button
              className="btn btn-primary btn-sm"
              type="submit"
              disabled={loading || !input.trim()}
              style={{ width: 36, height: 36, padding: 0, borderRadius: '50%', display: 'grid', placeItems: 'center' }}
            >
              <Send size={15} />
            </button>
          </form>
          <p style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4, margin: 0, padding: '4px 0 8px', color: 'var(--muted)', background: '#fff', fontSize: 10.5 }}>
            <CircleHelp size={12} /> AI can make mistakes. Check important details.
          </p>
        </aside>
      )}
    </>
  );
}