import { useEffect, useState } from 'react';
import { Box, Tooltip, Typography } from '@mui/material';
import { useI18n } from './i18n';
import { formatLocaleDateTime, swissLocale } from './localeFormat';
import { demoResetCountdown as countdown, nextDemoReset } from './demoReset';
import { instanceName, loadHealth } from './instance';

/** The instances' names in the box (the same in every language). */
const LABELS: Record<string, string> = { development: 'Development', local: 'Local', test: 'Test', demo: 'Demo', preprod: 'Preprod' };

interface Health {
  name: string;
  deployedAt: string | null;
  startedAt: string | null;
  everyHours: number | null;
}

/**
 * After the app bar's title, on every instance but prod (GET health `instance`): a box with the instance's name, its
 * last delivery on hover (development and local: since when the API runs). On demo (`demoReset`) a countdown to the
 * next reset follows, its colon ticking, and on hover when that is.
 */
export default function InstanceInfo() {
  const { t, locale } = useI18n();
  const [health, setHealth] = useState<Health | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let cancelled = false;
    void loadHealth()
      .then((data: any) => {
        const name = instanceName(data);
        if (cancelled || !name || !LABELS[name]) return;
        setHealth({
          name,
          deployedAt: typeof data.instance.deployedAt === 'string' ? data.instance.deployedAt : null,
          startedAt: typeof data.startedAt === 'string' ? data.startedAt : null,
          everyHours: Number(data.demoReset?.everyHours) || null,
        });
      });
    return () => { cancelled = true; };
  }, []);

  // The countdown's minutes: a clock every few seconds is enough (the colon ticks by CSS).
  useEffect(() => {
    if (!health?.everyHours) return;
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, [health?.everyHours]);

  if (!health) return null;
  const delivered = health.deployedAt
    ? t('instance.deployed', { date: formatLocaleDateTime(health.deployedAt, locale) })
    : health.startedAt ? t('instance.started', { date: formatLocaleDateTime(health.startedAt, locale) }) : '';
  const resetAt = health.everyHours ? nextDemoReset(now, health.everyHours) : null;
  const left = resetAt !== null ? countdown(now, resetAt) : null;

  return (
    // A few pixels down: on the title's line (its text sits low in the h6 line box).
    <Box sx={{ display: { xs: 'none', sm: 'flex' }, alignItems: 'center', gap: 1, position: 'relative', top: 3 }} onClick={(e) => e.stopPropagation()}>
      <Tooltip title={delivered} arrow>
        <Box
          component="span"
          sx={{
            px: 1, py: 0.25, borderRadius: 1, border: '1px solid rgba(255,255,255,0.45)', bgcolor: 'rgba(255,255,255,0.16)',
            fontSize: 12, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase', lineHeight: 1.6, cursor: 'default',
          }}
        >
          {LABELS[health.name]}
        </Box>
      </Tooltip>
      {left && resetAt !== null && (
        <Tooltip
          arrow
          title={t('demoReset.countdown', {
            time: `${left.hours}:${left.minutes}`,
            at: new Intl.DateTimeFormat(swissLocale(locale), { hour: '2-digit', minute: '2-digit' }).format(new Date(resetAt)),
          })}
        >
          <Typography
            component="span"
            variant="body2"
            sx={{
              fontWeight: 600, fontVariantNumeric: 'tabular-nums', cursor: 'default', opacity: 0.9,
              '@keyframes instanceTick': { '0%, 49%': { opacity: 1 }, '50%, 100%': { opacity: 0.15 } },
              '& .tick': { animation: 'instanceTick 1s steps(1) infinite' },
              '@media (prefers-reduced-motion: reduce)': { '& .tick': { animation: 'none' } },
            }}
          >
            {left.hours}<span className="tick">:</span>{left.minutes}
          </Typography>
        </Tooltip>
      )}
    </Box>
  );
}
