import React, { useEffect, useState, useCallback, useRef } from 'react';
import { CheckCircle, AlertCircle, X, ExternalLink } from 'lucide-react';
import { useTaskManager } from '../contexts/TaskContext';
import type { TaskNotification } from '../types';

interface ToastItem {
  notification: TaskNotification;
  entering: boolean;
  exiting: boolean;
}

const TOAST_DURATION = 6000;
const TOAST_MAX_VISIBLE = 4;

function requestDesktopPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

function sendDesktopNotification(title: string, body: string, isSuccess: boolean) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (document.hasFocus()) return;
  try {
    const n = new Notification(title, {
      body,
      icon: isSuccess ? '/static/icon-success.png' : '/static/icon-error.png',
      tag: `task-${Date.now()}`,
      silent: false,
    });
    n.onclick = () => { window.focus(); n.close(); };
    setTimeout(() => n.close(), 8000);
  } catch {}
}

function playNotificationSound(isSuccess: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = isSuccess ? 880 : 440;
    osc.type = 'sine';
    gain.gain.value = 0.15;
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

export const GlobalToast: React.FC<{ onNavigate?: (view: string, projectId?: string) => void }> = ({ onNavigate }) => {
  const { notifications, dismissNotification } = useTaskManager();
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const shownIdsRef = useRef<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  useEffect(() => { requestDesktopPermission(); }, []);

  useEffect(() => {
    for (const notif of notifications) {
      if (notif.status !== 'completed' && notif.status !== 'failed') continue;
      if (shownIdsRef.current.has(notif.id)) continue;
      shownIdsRef.current.add(notif.id);

      const isSuccess = notif.status === 'completed';
      playNotificationSound(isSuccess);
      sendDesktopNotification(
        isSuccess ? '任务完成' : '任务失败',
        notif.message,
        isSuccess
      );

      setToasts(prev => {
        const next = [{ notification: notif, entering: true, exiting: false }, ...prev];
        return next.slice(0, TOAST_MAX_VISIBLE + 2);
      });

      requestAnimationFrame(() => {
        setTimeout(() => {
          setToasts(prev => prev.map(t =>
            t.notification.id === notif.id ? { ...t, entering: false } : t
          ));
        }, 50);
      });

      const timer = setTimeout(() => {
        dismissToast(notif.id);
      }, TOAST_DURATION);
      timersRef.current.set(notif.id, timer);
    }
  }, [notifications]);

  useEffect(() => {
    return () => {
      timersRef.current.forEach(t => clearTimeout(t));
    };
  }, []);

  const dismissToast = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }

    setToasts(prev => prev.map(t =>
      t.notification.id === id ? { ...t, exiting: true } : t
    ));

    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.notification.id !== id));
    }, 300);
  }, []);

  const handleClick = useCallback((notif: TaskNotification) => {
    dismissToast(notif.id);
    dismissNotification(notif.id);
    if (onNavigate && notif.targetView) {
      onNavigate(notif.targetView, notif.targetProjectId);
    }
  }, [dismissToast, dismissNotification, onNavigate]);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 pointer-events-none" style={{ maxWidth: 380 }}>
      {toasts.slice(0, TOAST_MAX_VISIBLE).map((toast, index) => {
        const { notification: notif, entering, exiting } = toast;
        const isSuccess = notif.status === 'completed';

        return (
          <div
            key={notif.id}
            className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-lg shadow-2xl border backdrop-blur-sm transition-all duration-300 ease-out cursor-pointer
              ${isSuccess
                ? 'bg-gray-900/95 border-green-500/30 hover:border-green-500/60'
                : 'bg-gray-900/95 border-red-500/30 hover:border-red-500/60'}
              ${entering ? 'translate-x-full opacity-0' : exiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
            `}
            style={{ transitionDelay: entering ? `${index * 50}ms` : '0ms' }}
            onClick={() => handleClick(notif)}
          >
            <div className="mt-0.5 flex-shrink-0">
              {isSuccess
                ? <CheckCircle className="w-5 h-5 text-green-400" />
                : <AlertCircle className="w-5 h-5 text-red-400" />
              }
            </div>

            <div className="flex-1 min-w-0">
              <div className="text-sm font-medium text-white truncate">
                {notif.message}
              </div>
              <div className="text-xs text-gray-400 mt-0.5 flex items-center gap-1.5">
                <span>
                  {notif.type === 'video' ? '视频' : notif.type === 'image' ? '图片' : notif.type === 'text' ? '文本' : '素材'}
                </span>
                <span>·</span>
                <span>{new Date(notif.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
              </div>
              {isSuccess && notif.targetView && (
                <div className="mt-1.5 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                  <ExternalLink className="w-3 h-3" />
                  <span>点击查看结果</span>
                </div>
              )}
            </div>

            <button
              onClick={(e) => {
                e.stopPropagation();
                dismissToast(notif.id);
              }}
              className="flex-shrink-0 p-1 hover:bg-white/10 rounded transition-colors text-gray-500 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
};
