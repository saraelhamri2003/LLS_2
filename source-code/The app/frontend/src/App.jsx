import React, { useState, useRef, useEffect, useMemo } from 'react';
import { Send, Calculator, MessageSquare, TrendingUp, AlertCircle, Loader2, ClipboardCheck, ArrowLeft, Trash2 } from 'lucide-react';
import AppSidebar from './components/AppSidebar';
import CompaniesPage from './components/CompaniesPage';
import UsersPage from './components/UsersPage';
import useUsers from './hooks/useUsers';
import './layout.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:5001';

const FACTOR_LABELS = [
  'Leadership Engagement',
  'Cultural Change',
  'Communication',
  'Training',
  'Tools & Techniques',
  'Employee Involvement',
  'Expertise & Skills'
];

const DEFAULT_LEVEL_CHOICES = [
  { level: 1, title: 'Initial', detail: 'No formal practice; ad-hoc or absent.' },
  { level: 2, title: 'Basic', detail: 'Some awareness; inconsistent execution.' },
  { level: 3, title: 'Defined', detail: 'Standardized and repeatable.' },
  { level: 4, title: 'Managed', detail: 'Measured, controlled, and improving.' },
  { level: 5, title: 'Optimized', detail: 'Continuous improvement; best practice.' }
];

const LOCAL_MODEL_OPTIONS = [
  'llama3:8b',
  'llama3:70b',
  'llama3.1:8b',
  'mistral:7b',
  'mixtral:8x7b',
  'gemma2:9b',
  'qwen2.5:7b',
  'phi3:mini'
];

const API_MODEL_CATALOG = [
  {
    provider: 'Google',
    families: [
      {
        family: 'Gemini 3',
        models: ['Gemini 3 Pro', 'Gemini 3 Flash']
      },
      {
        family: 'Gemini 2.5',
        models: ['Gemini 2.5 Pro', 'Gemini 2.5 Flash', 'Gemini 2.5 Flash-Lite']
      }
    ]
  },
  {
    provider: 'OpenAI',
    families: [
      {
        family: 'GPT-5.2',
        models: ['GPT-5.2 Instant', 'GPT-5.2 Thinking', 'GPT-5.2 Pro']
      },
      {
        family: 'GPT-5.1',
        models: ['GPT-5.1 Instant', 'GPT-5.1 Thinking']
      },
      {
        family: 'GPT-4.1',
        models: ['GPT-4.1', 'GPT-4.1 Mini', 'GPT-4.1 Nano']
      },
      {
        family: 'Specialized',
        models: ['Codex', 'Vision', 'Audio']
      }
    ]
  },
  {
    provider: 'Anthropic',
    families: [
      {
        family: 'Claude 4.5',
        models: ['Claude Opus 4.5', 'Claude Sonnet 4.5', 'Claude Haiku 4.5']
      }
    ]
  }
];

const ASSISTED_STEPS = [
  ...FACTOR_LABELS.map((label, index) => ({
    group: 'IL',
    index,
    code: `IL${index + 1}`,
    label: `${label} (Lean)`
  })),
  ...FACTOR_LABELS.map((label, index) => ({
    group: 'IS',
    index,
    code: `IS${index + 1}`,
    label: `${label} (Six Sigma)`
  })),
  ...FACTOR_LABELS.map((label, index) => ({
    group: 'IM',
    index,
    code: `IM${index + 1}`,
    label: `${label} (Maturity)`
  }))
];

const ASSISTED_LABELS = Object.fromEntries(
  ASSISTED_STEPS.map((step) => [step.code, step.label])
);

const INTRO_MESSAGES = [
  {
    role: 'assistant',
    content: 'Welcome to the AI-Driven Lean Six Sigma Performance Engine. Ask about DMAIC, capability, or improvement strategy.'
  },
  {
    role: 'assistant',
    content: 'Start the Guided Assessment for step by step scoring of IL, IS, and IM factors.'
  }
];

const getIntroMessages = () => INTRO_MESSAGES.map((message) => ({ ...message }));

const createEmptyParameters = () => ({
  IL: Array(7).fill(''),
  IS: Array(7).fill(''),
  IM: Array(7).fill('')
});

const buildAssistedPrompt = (stepIndex) => {
  const step = ASSISTED_STEPS[stepIndex];
  const position = stepIndex + 1;
  return `Step ${position} of ${ASSISTED_STEPS.length}: ${step.code} - ${step.label}. Enter a score from 1 to 5.`;
};

const LeanSixSigmaChatbot = () => {
  const [messages, setMessages] = useState(getIntroMessages);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState('chat');
  const [themeMode, setThemeMode] = useState(() => localStorage.getItem('lss_theme') || 'light');
  const [showIntro, setShowIntro] = useState(true);
  const [uiLanguage, setUiLanguage] = useState('en');
  const [loadingMessage, setLoadingMessage] = useState('');
  const [parameters, setParameters] = useState(createEmptyParameters());
  const [panelsCollapsed, setPanelsCollapsed] = useState(false);
  const [assistedAssessment, setAssistedAssessment] = useState({
    active: false,
    stepIndex: 0,
    parameters: createEmptyParameters(),
    review: false
  });
  const [csfLevels, setCsfLevels] = useState({ levels: {}, labels: {}, prescriptions: {} });
  const [calcResult, setCalcResult] = useState(null);
  const [lastCalcParams, setLastCalcParams] = useState(createEmptyParameters());
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState(() => {
    const defaults = { localModel: 'llama3:8b', apiModel: 'gemini-3.8-flash', apiKey: '', useApi: true };
    try {
      const saved = JSON.parse(localStorage.getItem('lss_model_config') || 'null');
      return saved ? { ...defaults, ...saved, apiKey: '' } : defaults;
    } catch { return defaults; }
  });
  const [apiTestState, setApiTestState] = useState({
    status: 'idle',
    message: '',
    details: null
  });
  const [calcExplanation, setCalcExplanation] = useState('');
  const [calcExplanationLoading, setCalcExplanationLoading] = useState(false);
  const [explainLoadingId, setExplainLoadingId] = useState(null);
  // ===== USER AUTH STATE =====
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem('lss_user') || 'null');
    } catch { return null; }
  });
  // ===== NEW LAYOUT STATE =====
  const [view, setView] = useState('chat'); // 'chat' | 'guided' | 'companies' | 'users'
  const [sidebarExpanded, setSidebarExpanded] = useState(false);
  const [sidebarSection, setSidebarSection] = useState(null);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
 
  const handleLogout = () => {
    localStorage.removeItem('lss_token');
    localStorage.removeItem('lss_user');
    window.location.href = '/login.html';
  };
 
  const isAdmin = currentUser?.role === 'admin';

  // ===== SAVED CONVERSATIONS (kept in this browser, separately for each user) =====
  const convStorageKey = `lss_conversations_${currentUser?.id ?? 'guest'}`;
  const [conversations, setConversations] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(`lss_conversations_${currentUser?.id ?? 'guest'}`) || '[]');
    } catch { return []; }
  });
  const [activeConvId, setActiveConvId] = useState(null);
  const activeConvRef = useRef(null);
  const skipNextSaveRef = useRef(false);

  // Save the open conversation every time a message is added
  useEffect(() => {
    if (skipNextSaveRef.current) { skipNextSaveRef.current = false; return; }
    if (messages.length <= INTRO_MESSAGES.length) return; // nothing written yet
    let id = activeConvRef.current;
    if (!id) {
      id = `c${Date.now()}`;
      activeConvRef.current = id;
      setActiveConvId(id);
    }
    const firstUser = messages.find((m) => m.role === 'user');
    const title = firstUser?.content?.slice(0, 80)
      || (messages.some((m) => m.type === 'calculation') ? 'Performance calculation' : 'Conversation');
    setConversations((prev) => {
      const existing = prev.find((c) => c.id === id);
      const updated = {
        id,
        title,
        createdAt: existing?.createdAt || Date.now(),
        updatedAt: Date.now(),
        messages
      };
      return [updated, ...prev.filter((c) => c.id !== id)].slice(0, 50);
    });
  }, [messages]);

  useEffect(() => {
    try {
      localStorage.setItem(convStorageKey, JSON.stringify(conversations));
    } catch {
      // Browser storage full: keep only the 20 most recent conversations
      try { localStorage.setItem(convStorageKey, JSON.stringify(conversations.slice(0, 20))); } catch { /* ignore */ }
    }
  }, [conversations, convStorageKey]);

  const timeAgo = (ms) => {
    const minutes = Math.round((Date.now() - ms) / 60000);
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return new Date(ms).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  };
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const inputRef = useRef(null);
  const panelsCollapsedRef = useRef(false);

  const historyItems = useMemo(
    () => messages.filter((msg) => msg.role === 'user'),
    [messages]
  );
  const hasAnyParameter = useMemo(
    () => Object.values(parameters).some((values) => values.some((value) => value !== '')),
    [parameters]
  );
  const reviewReady = useMemo(() => {
    if (!assistedAssessment.review) return false;
    const groups = ['IL', 'IS', 'IM'];
    return groups.every((group) => {
      const values = assistedAssessment.parameters?.[group] || [];
      if (values.length !== 7) return false;
      return values.every((value) => {
        const parsed = Number(value);
        return Number.isInteger(parsed) && parsed >= 1 && parsed <= 5;
      });
    });
  }, [assistedAssessment.parameters, assistedAssessment.review]);
  const isDark = themeMode === 'dark';
  const themeClass = (darkClass, lightClass) => (isDark ? darkClass : lightClass);
  const activeModelLabel = modelConfig.useApi
    ? `API (${modelConfig.apiModel.trim() || 'gemini-pro'})`
    : `Local (${modelConfig.localModel.trim() || 'llama3:8b'})`;
  const apiModelSelected = modelConfig.apiModel.trim().toLowerCase();
  const apiTestBadge = useMemo(() => {
    if (apiTestState.status === 'idle') return null;
    if (apiTestState.status === 'loading') {
      return { label: 'Testing', className: 'badge badge--neutral' };
    }
    if (apiTestState.status === 'api') {
      return { label: 'API OK', className: 'badge badge--low' };
    }
    if (apiTestState.status === 'fallback') {
      return { label: 'Fallback', className: 'badge badge--mid' };
    }
    return { label: 'Error', className: 'badge badge--high' };
  }, [apiTestState.status]);
  const guidedStatus = assistedAssessment.active
    ? `In progress ${assistedAssessment.stepIndex + 1}/${ASSISTED_STEPS.length}`
    : assistedAssessment.review
      ? 'Review pending'
      : 'Ready';
  const autoCollapseEnabled = !showModelSettings && !assistedAssessment.active && !assistedAssessment.review;

  useEffect(() => {
    if (!loading) {
      setLoadingMessage('');
      return;
    }
    const steps = [
      'Analyzing your question...',
      'Reviewing L6S knowledge base...',
      'Generating response...'
    ];
    let index = 0;
    setLoadingMessage(steps[index]);
    const interval = setInterval(() => {
      index = Math.min(index + 1, steps.length - 1);
      setLoadingMessage(steps[index]);
    }, 1500);
    return () => clearInterval(interval);
  }, [loading]);

  const toAverage = (values) => {
    const nums = values
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value));
    if (!nums.length) return 0;
    return nums.reduce((sum, value) => sum + value, 0) / nums.length;
  };

  const localAnalysis = useMemo(() => ({
    IL_average: toAverage(parameters.IL),
    IS_average: toAverage(parameters.IS),
    IM_average: toAverage(parameters.IM)
  }), [parameters]);

  const analysis = useMemo(
    () => calcResult?.parameter_analysis || localAnalysis,
    [calcResult, localAnalysis]
  );

  const radarValues = useMemo(() => ([
    { label: 'IL', value: analysis.IL_average },
    { label: 'IS', value: analysis.IS_average },
    { label: 'IM', value: analysis.IM_average }
  ]), [analysis]);

  const radarSize = 180;
  const { radarPoints, radarAxisPoints } = useMemo(() => {
    const radarCenter = radarSize / 2;
    const radarRadius = radarCenter - 12;
    const points = radarValues.map((item, index) => {
      const angle = (Math.PI * 2 * index) / radarValues.length - Math.PI / 2;
      const normalized = Math.max(0, Math.min(1, (item.value || 0) / 5));
      const r = radarRadius * normalized;
      const x = radarCenter + r * Math.cos(angle);
      const y = radarCenter + r * Math.sin(angle);
      return `${x},${y}`;
    }).join(' ');
    const axisPoints = radarValues.map((_, index) => {
      const angle = (Math.PI * 2 * index) / radarValues.length - Math.PI / 2;
      const x = radarCenter + radarRadius * Math.cos(angle);
      const y = radarCenter + radarRadius * Math.sin(angle);
      return `${x},${y}`;
    }).join(' ');
    return { radarPoints: points, radarAxisPoints: axisPoints };
  }, [radarValues]);

  const radarColors = useMemo(() => ({
    grid: isDark ? '#243041' : '#d4dde8',
    stroke: 'var(--accent)',
    fill: isDark ? 'rgba(var(--brand-blue-rgb), 0.32)' : 'rgba(var(--brand-blue-rgb), 0.2)'
  }), [isDark]);

  const formatMetric = (value, digits = 1) => {
    const num = Number(value);
    if (!Number.isFinite(num)) {
      return value ? String(value) : 'N/A';
    }
    return num.toFixed(digits);
  };

  const getGapBadgeClass = (value) => {
    const num = Number(value);
    if (!Number.isFinite(num)) return 'badge--neutral';
    if (num >= 15) return 'badge--high';
    if (num >= 7) return 'badge--mid';
    return 'badge--low';
  };

  const getCategoryToneClass = (category) => {
    const lower = String(category || '').toLowerCase();
    if (lower.includes('financial')) return 'tone-amber';
    if (lower.includes('operational')) return 'tone-sky';
    if (lower.includes('innovation')) return 'tone-teal';
    return 'tone-neutral';
  };

  const getFactorToneClass = (code) => {
    const normalized = String(code || '').toUpperCase();
    if (normalized.startsWith('IL')) return 'tone-amber';
    if (normalized.startsWith('IS')) return 'tone-sky';
    if (normalized.startsWith('IM')) return 'tone-teal';
    return 'tone-neutral';
  };

  const renderRadarSvg = (labels, values, maxValue) => {
    const size = 220;
    const center = size / 2;
    const radius = center - 26;
    const gridLevels = 4;
    const labelStep = Math.max(1, Math.ceil(labels.length / 10));
    const gridColor = isDark ? '#1f2937' : '#e2e8f0';
    const areaStroke = 'var(--accent)';
    const areaFill = isDark ? 'rgba(var(--brand-blue-rgb), 0.26)' : 'rgba(var(--brand-blue-rgb), 0.18)';
    const pointFor = (value, index, scale = 1) => {
      const angle = (Math.PI * 2 * index) / labels.length - Math.PI / 2;
      const r = radius * scale * (value / maxValue);
      const x = center + r * Math.cos(angle);
      const y = center + r * Math.sin(angle);
      return { x, y, angle };
    };

    const polygonPoints = values.map((value, index) => {
      const point = pointFor(value, index, 1);
      return `${point.x},${point.y}`;
    }).join(' ');

    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        {Array.from({ length: gridLevels }).map((_, level) => {
          const scale = (level + 1) / gridLevels;
          const gridPoints = labels.map((_, index) => {
            const angle = (Math.PI * 2 * index) / labels.length - Math.PI / 2;
            const r = radius * scale;
            const x = center + r * Math.cos(angle);
            const y = center + r * Math.sin(angle);
            return `${x},${y}`;
          }).join(' ');
          return (
            <polygon
              key={`grid-${scale}`}
              points={gridPoints}
              fill="none"
              stroke={gridColor}
              strokeWidth="1"
            />
          );
        })}
        {labels.map((label, index) => {
          const point = pointFor(maxValue, index, 1);
          return (
            <line
              key={`axis-${label}-${index}`}
              x1={center}
              y1={center}
              x2={point.x}
              y2={point.y}
              stroke={gridColor}
              strokeWidth="1"
            />
          );
        })}
        <polygon points={polygonPoints} fill={areaFill} stroke={areaStroke} strokeWidth="2" />
        {labels.map((label, index) => {
          if (index % labelStep !== 0) return null;
          const point = pointFor(maxValue, index, 1);
          const labelOffset = 10;
          const x = center + (radius + labelOffset) * Math.cos(point.angle);
          const y = center + (radius + labelOffset) * Math.sin(point.angle);
          const anchor = Math.cos(point.angle) > 0.2 ? 'start' : Math.cos(point.angle) < -0.2 ? 'end' : 'middle';
          const baseline = Math.sin(point.angle) > 0.2 ? 'hanging' : Math.sin(point.angle) < -0.2 ? 'auto' : 'middle';
          return (
            <text
              key={`label-${label}-${index}`}
              x={x}
              y={y}
              textAnchor={anchor}
              dominantBaseline={baseline}
              fontSize="9"
              fill={isDark ? '#94a3b8' : '#64748b'}
            >
              {label}
            </text>
          );
        })}
      </svg>
    );
  };

  const renderChartBlock = (chartData, title) => {
    if (!chartData?.labels?.length || !chartData?.datasets?.length) return null;
    const dataset = chartData.datasets[0] || {};
    const values = (dataset.data || []).map((value) => (Number.isFinite(value) ? value : 0));
    const maxValue = Math.max(...values, 1);
    const showRadar = chartData.labels.length >= 3;
    return (
      <div className={`mt-3 rounded-xl border p-4 ${themeClass('border-slate-800 bg-slate-900/80', 'border-slate-200 bg-white')}`}>
        <div className={`text-sm font-semibold ${themeClass('text-slate-100', 'text-slate-900')}`}>
          {title || dataset.label || 'CSF Profile'}
        </div>
        <div className={`mt-3 grid gap-4 ${showRadar ? 'md:grid-cols-[220px_1fr]' : ''}`}>
          {showRadar && (
            <div className="flex items-center justify-center">
              {renderRadarSvg(chartData.labels, values, maxValue)}
            </div>
          )}
          <div className="space-y-2 max-h-72 overflow-y-auto pr-2">
            {chartData.labels.map((label, index) => {
              const value = values[index] ?? 0;
              const width = `${Math.round((value / maxValue) * 100)}%`;
              return (
                <div key={`${label}-${index}`} className="flex items-center gap-2 text-xs">
                  <div className={`w-10 shrink-0 ${themeClass('text-slate-400', 'text-slate-500')}`}>{label}</div>
                  <div className={`h-2 flex-1 rounded-full ${themeClass('bg-slate-800', 'bg-slate-200')}`}>
                    <div className="h-2 rounded-full bg-accent" style={{ width }} />
                  </div>
                  <div className={`w-12 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>
                    {formatMetric(value, 2)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    );
  };

  const renderPerformanceTable = (tableData) => {
    if (!tableData) return null;
    const summary = tableData.high_level_summary || {};
    const primary = tableData.primary_criteria || [];
    const subCriteria = tableData.sub_criteria || {};
    const subEntries = Object.entries(subCriteria);

    return (
      <div className={`mt-4 rounded-xl border p-4 ${themeClass('border-slate-800 bg-slate-900/80', 'border-slate-200 bg-white')}`}>
        <div className={`text-sm font-semibold ${themeClass('text-slate-100', 'text-slate-900')}`}>
          Performance Table
        </div>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="stat-card stat-card--strategy">
            <div className="stat-card__label">Strategy</div>
            <div className="stat-card__value">{summary.recommended_strategy || 'N/A'}</div>
          </div>
          <div className="stat-card stat-card--current">
            <div className="stat-card__label">Current</div>
            <div className="stat-card__value stat-card__value--big">
              {formatMetric(summary.current_performance)}%
            </div>
          </div>
          <div className="stat-card stat-card--target">
            <div className="stat-card__label">Target</div>
            <div className="stat-card__value stat-card__value--big">
              {formatMetric(summary.target_performance)}%
            </div>
          </div>
        </div>

        {primary.length > 0 && (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-xs data-table">
              <thead>
                <tr className={themeClass('text-slate-400', 'text-slate-500')}>
                  <th className="px-2 py-2 text-left">Criterion</th>
                  <th className="px-2 py-2 text-right">Weight</th>
                  <th className="px-2 py-2 text-right">Current</th>
                  <th className="px-2 py-2 text-right">Target</th>
                  <th className="px-2 py-2 text-right">Gap</th>
                </tr>
              </thead>
              <tbody>
                {primary.map((row, index) => {
                  const gapClass = getGapBadgeClass(row.gap);
                  const gapValue = formatMetric(row.gap);
                  const gapLabel = gapValue === 'N/A' ? 'N/A' : `${gapValue}%`;
                  return (
                    <tr key={`${row.criterion}-${index}`} className={themeClass('border-slate-800', 'border-slate-200')}>
                      <td className={`px-2 py-2 ${themeClass('text-slate-200', 'text-slate-700')}`}>{row.criterion}</td>
                      <td className={`px-2 py-2 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>{formatMetric(row.weight, 3)}</td>
                      <td className={`px-2 py-2 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>{formatMetric(row.real_performance)}%</td>
                      <td className={`px-2 py-2 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>{formatMetric(row.target_performance)}%</td>
                      <td className={`px-2 py-2 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>
                        <span className={`badge ${gapClass}`}>{gapLabel}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {subEntries.length > 0 && (
          <div className="mt-4 space-y-3">
            {subEntries.map(([category, rows]) => (
              <div key={category} className={`criteria-card ${getCategoryToneClass(category)}`}>
                <div className={`criteria-title text-xs ${themeClass('text-slate-200', 'text-slate-700')}`}>
                  {category}
                </div>
                <div className="mt-2 overflow-x-auto">
                  <table className="min-w-full text-xs data-table data-table--compact">
                    <thead>
                      <tr className={themeClass('text-slate-400', 'text-slate-500')}>
                        <th className="px-2 py-1 text-left">Sub-criterion</th>
                        <th className="px-2 py-1 text-right">Weight</th>
                        <th className="px-2 py-1 text-right">Contribution</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(rows || []).map((row, index) => (
                        <tr key={`${category}-${index}`} className={themeClass('border-slate-800', 'border-slate-200')}>
                          <td className={`px-2 py-1 ${themeClass('text-slate-200', 'text-slate-700')}`}>{row.subcategory}</td>
                          <td className={`px-2 py-1 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>{formatMetric(row.weight, 3)}</td>
                          <td className={`px-2 py-1 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>{formatMetric(row.contribution)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  const buildLevelUpActions = (params) => {
    const actions = [];
    const addActions = (prefix, values) => {
      if (!Array.isArray(values)) return;
      values.forEach((value, index) => {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return;
        const current = Math.max(1, Math.min(5, Math.round(parsed)));
        const nextLevel = Math.min(current + 1, 5);
        const code = `${prefix}${index + 1}`;
        const actionMap = csfLevels.prescriptions?.[code] || {};
        const nextAction = actionMap[nextLevel] || (current >= 5 ? 'Maintain current level.' : 'No prescription available.');

        actions.push({
          code,
          label: csfLevels.labels?.[code] || code,
          current,
          next: nextLevel,
          action: nextAction
        });
      });
    };

    addActions('IL', params?.IL || []);
    addActions('IS', params?.IS || []);
    addActions('IM', params?.IM || []);
    return actions;
  };

  const renderLevelUpTable = (params) => {
    const actions = buildLevelUpActions(params);
    if (!actions.length) return null;

    return (
      <div className={`mt-4 rounded-xl border p-4 ${themeClass('border-slate-800 bg-slate-900/80', 'border-slate-200 bg-white')}`}>
        <div className={`text-sm font-semibold ${themeClass('text-slate-100', 'text-slate-900')}`}>
          Next-Level Action Table
        </div>
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs data-table">
            <thead>
              <tr className={themeClass('text-slate-400', 'text-slate-500')}>
                <th className="px-2 py-2 text-left">Factor</th>
                <th className="px-2 py-2 text-right">Current</th>
                <th className="px-2 py-2 text-right">Next</th>
                <th className="px-2 py-2 text-left">Action to Reach Next Level</th>
              </tr>
            </thead>
            <tbody>
              {actions.map((row, index) => {
                const toneClass = getFactorToneClass(row.code);
                return (
                  <tr key={`${row.code}-${index}`} className={`${themeClass('border-slate-800', 'border-slate-200')} ${toneClass}`}>
                    <td className={`px-2 py-2 ${themeClass('text-slate-200', 'text-slate-700')}`}>
                      <div className={`factor-cell ${toneClass}`}>
                        <span className="factor-tag">{row.code}</span>
                        <span className={`factor-label ${themeClass('text-slate-200', 'text-slate-700')}`}>
                          {row.label}
                        </span>
                      </div>
                    </td>
                    <td className={`px-2 py-2 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>
                      <span className="level-pill level-pill--current">{row.current}</span>
                    </td>
                    <td className={`px-2 py-2 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>
                      <span className="level-pill level-pill--next">{row.next}</span>
                    </td>
                    <td className={`px-2 py-2 action-cell ${themeClass('text-slate-300', 'text-slate-600')}`}>
                      {row.action}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };

  
  const renderTargetActionTable = (table) => {
    if (!table?.rows?.length) return null;

    const title = table.title || 'Target Action Table';
    const normalizeLevel = (value) => {
      if (value === null || value === undefined || value === '') return null;
      const num = Math.round(Number(value));
      if (!Number.isFinite(num) || num < 1 || num > 5) return null;
      return num;
    };

    const grouped = table.rows.reduce((acc, row) => {
      const key = row.factor || row.label || 'Unknown';
      if (!acc[key]) {
        acc[key] = {
          factor: row.factor || key,
          label: row.label || row.factor || key,
          current: null,
          target: null,
          steps: []
        };
      }

      const currentValue = normalizeLevel(row.current);
      if (currentValue !== null && acc[key].current === null) {
        acc[key].current = currentValue;
      }

      const targetValue = normalizeLevel(row.target);
      if (targetValue !== null) {
        acc[key].target = targetValue;
      }

      const levelValue = normalizeLevel(row.level);
      if (levelValue !== null) {
        acc[key].steps.push({
          level: levelValue,
          action: row.action || 'N/A'
        });
      }

      return acc;
    }, {});

    const groups = Object.values(grouped)
      .map((group) => ({
        ...group,
        steps: (group.steps || []).sort((a, b) => (a.level ?? 0) - (b.level ?? 0))
      }))
      .sort((a, b) => `${a.factor}`.localeCompare(`${b.factor}`));

    const showCurrent = groups.some((group) => group.current !== null);
    const needsCurrent = groups.every((group) => group.current === null);

    return (
      <div className={`mt-4 rounded-xl border p-4 ${themeClass('border-slate-800 bg-slate-900/80', 'border-slate-200 bg-white')}`}>
        <div className={`text-sm font-semibold ${themeClass('text-slate-100', 'text-slate-900')}`}>
          {title}
        </div>
        {needsCurrent && (
          <div className={`mt-2 text-xs ${themeClass('text-slate-400', 'text-slate-500')}`}>
            Provide current CSF scores to personalize the steps.
          </div>
        )}
        <div className="mt-3 overflow-x-auto">
          <table className="min-w-full text-xs align-top data-table data-table--compact">
            <thead>
              <tr className={themeClass('text-slate-400', 'text-slate-500')}>
                <th className="px-2 py-2 text-left">Factor</th>
                {showCurrent && <th className="px-2 py-2 text-right">Current</th>}
                <th className="px-2 py-2 text-right">Target</th>
                <th className="px-2 py-2 text-left">Steps to Reach Target</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, index) => {
                const toneClass = getFactorToneClass(group.factor);
                return (
                  <tr key={`${group.factor}-${index}`} className={`${themeClass('border-slate-800', 'border-slate-200')} ${toneClass}`}>
                    <td className={`px-2 py-2 ${themeClass('text-slate-200', 'text-slate-700')}`}>
                      <div className={`factor-cell ${toneClass}`}>
                        <span className="factor-tag">{group.factor}</span>
                        <span className={`factor-label ${themeClass('text-slate-200', 'text-slate-700')}`}>
                          {group.label}
                        </span>
                      </div>
                    </td>
                    {showCurrent && (
                      <td className={`px-2 py-2 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>
                        {group.current === null ? (
                          'N/A'
                        ) : (
                          <span className="level-pill level-pill--current">{group.current}</span>
                        )}
                      </td>
                    )}
                    <td className={`px-2 py-2 text-right ${themeClass('text-slate-300', 'text-slate-600')}`}>
                      {group.target === null ? (
                        'N/A'
                      ) : (
                        <span className="level-pill level-pill--target">{group.target}</span>
                      )}
                    </td>
                    <td className={`px-2 py-2 action-cell ${themeClass('text-slate-300', 'text-slate-600')}`}>
                      {group.steps.length ? (
                        <ol className="list-decimal pl-4 space-y-1">
                          {group.steps.map((step) => (
                            <li key={`${group.factor}-${step.level}`}>
                              <span className="step-chip">L{step.level}</span>{' '}
                              {step.action}
                            </li>
                          ))}
                        </ol>
                      ) : (
                        <span>N/A</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    );
  };



  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', themeMode);
    document.documentElement.style.colorScheme = themeMode;
    try { localStorage.setItem('lss_theme', themeMode); } catch { /* private mode */ }
  }, [themeMode]);

  useEffect(() => {
    const { apiKey, ...rest } = modelConfig;
    try { localStorage.setItem('lss_model_config', JSON.stringify(rest)); } catch { /* private mode */ }
  }, [modelConfig]);

  useEffect(() => {
    if (assistedAssessment.active) return;
    scrollToBottom();
  }, [messages, assistedAssessment.active]);

  useEffect(() => {
    if ((showModelSettings || assistedAssessment.active || assistedAssessment.review)
      && panelsCollapsedRef.current) {
      updatePanelsCollapsed(false);
    }
  }, [showModelSettings, assistedAssessment.active, assistedAssessment.review]);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowIntro(false);
    }, 3200);
    return () => clearTimeout(timer);
  }, []);

  useEffect(() => {
    const loadLevels = async () => {
      try {
        const response = await fetch(`${API_BASE}/csf-levels?lang=${uiLanguage}`);
        if (!response.ok) return;
        const data = await response.json();
        setCsfLevels({
          levels: data.levels || {},
          labels: data.labels || {},
          prescriptions: data.prescriptions || {}
        });
      } catch (error) {
        setCsfLevels({ levels: {}, labels: {}, prescriptions: {} });
      }
    };
    loadLevels();
  }, [uiLanguage]);

  // ===== USERS, NAVIGATION, TOAST =====
  const usersApi = useUsers(isAdmin);

  const showToast = (text, isError = false) => {
    clearTimeout(toastTimer.current);
    setToast({ text, isError });
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  };

  // Main area: chat (home), guided assessment, companies or users
  const navigate = (next) => {
    setSidebarExpanded(false);
    if (next === 'chat') {
      setView('chat');
      setActiveTab('chat');
      setSidebarSection(null);
      return;
    }
    if (next === 'companies' || next === 'users') setSidebarSection(null);
    setView(next);
  };

  // Esc: close the sidebar first, then go back home
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      if (sidebarExpanded) { setSidebarExpanded(false); return; }
      if (view === 'companies' || view === 'users') navigate('chat');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sidebarExpanded, view]); // eslint-disable-line react-hooks/exhaustive-deps

  const detectLanguage = (text) => {
    if (/[\u0600-\u06FF]/.test(text)) return 'Arabic';
    const lower = text.toLowerCase();
    const frenchMarkers = [
      'bonjour',
      'merci',
      's il',
      's il vous plait',
      'pourquoi',
      'comment',
      'avec',
      'dans',
      'amelior',
      'processus',
      'qualite'
    ];
    if (frenchMarkers.some((marker) => lower.includes(marker))) return 'French';
    return 'English';
  };

  const updateModelConfig = (updates, options = {}) => {
    setModelConfig((prev) => ({ ...prev, ...updates }));
    if (!options.keepApiTestState) {
      setApiTestState((prev) => (prev.status === 'idle'
        ? prev
        : { status: 'idle', message: '', details: null }));
    }
  };

  const buildModelConfigPayload = () => {
    const localModel = modelConfig.localModel.trim() || 'llama3:8b';
    const apiModel = modelConfig.apiModel.trim() || 'gemini-pro';
    const apiKey = modelConfig.apiKey.trim();

    const payload = {
      local_model: localModel,
      api_model: apiModel,
      use_api: modelConfig.useApi
    };

    if (apiKey) {
      payload.api_key = apiKey;
    }

    return payload;
  };

  const runApiTest = async () => {
    if (apiTestState.status === 'loading') return;
    setApiTestState({ status: 'loading', message: 'Testing API model...', details: null });

    try {
      const modelConfigPayload = buildModelConfigPayload();
      const response = await fetch(`${API_BASE}/llm-test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + localStorage.getItem('lss_token')
        },
        body: JSON.stringify({
          modelConfig: {
            ...modelConfigPayload,
            use_api: true
          }
        })
      });

      const rawText = await response.text();
      let data = null;
      try {
        data = rawText ? JSON.parse(rawText) : null;
      } catch (parseError) {
        const preview = rawText.trim().slice(0, 180);
        const hint = preview ? `Non-JSON response from ${API_BASE}/llm-test: ${preview}` : 'Empty response from backend.';
        throw new Error(hint);
      }

      if (!response.ok) {
        const errorMessage = data?.message || `Request failed (${response.status}).`;
        throw new Error(errorMessage);
      }

      const status = data?.status || (data?.ok ? 'api' : 'error');
      const details = data?.model_info || null;
      const usedModel = details?.used_model || '';
      const errorDetail = details?.error || '';
      let message = data?.message || '';

      if (status === 'api') {
        message = `API OK using ${usedModel || modelConfig.apiModel || 'external model'}.`;
      } else if (status === 'fallback') {
        message = errorDetail
          ? `API failed: ${errorDetail}. Local fallback used (${usedModel || modelConfig.localModel || 'local model'}).`
          : `API failed; local fallback used (${usedModel || modelConfig.localModel || 'local model'}).`;
        updateModelConfig({ useApi: false }, { keepApiTestState: true });
      } else if (status === 'error') {
        message = errorDetail ? `API error: ${errorDetail}` : 'API test failed.';
        updateModelConfig({ useApi: false }, { keepApiTestState: true });
      } else if (!message) {
        message = 'API test failed.';
      }

      setApiTestState({ status, message, details });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setApiTestState({ status: 'error', message: errorMessage, details: null });
    }
  };

  const formatScoreList = (prefix, values) => {
    if (!Array.isArray(values)) return 'N/A';
    const items = values
      .map((value, index) => {
        if (value === '' || value === null || value === undefined) return null;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return null;
        const level = Math.round(parsed);
        if (level < 1 || level > 5) return null;
        return { key: `${prefix}${index + 1}`, value: level };
      })
      .filter(Boolean);
    if (!items.length) return 'N/A';
    return items.map(({ key, value }) => `${key}=${value}`).join(', ');
  };

  const buildScoreMap = (params) => {
    const scores = {};
    const addScores = (prefix, values) => {
      if (!Array.isArray(values)) return;
      values.forEach((value, index) => {
        if (value === '' || value === null || value === undefined) return;
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return;
        const level = Math.round(parsed);
        if (level < 1 || level > 5) return;
        scores[`${prefix}${index + 1}`] = level;
      });
    };

    addScores('IL', params?.IL || []);
    addScores('IS', params?.IS || []);
    addScores('M', params?.IM || []);
    return scores;
  };

  const buildScoreContext = (params) => {
    const scores = buildScoreMap(params);
    const order = [
      ...Array.from({ length: 7 }, (_, i) => `IL${i + 1}`),
      ...Array.from({ length: 7 }, (_, i) => `IS${i + 1}`),
      ...Array.from({ length: 7 }, (_, i) => `M${i + 1}`)
    ];
    const items = order
      .filter((key) => Number.isFinite(scores[key]))
      .map((key) => `${key}=${scores[key]}`);
    if (!items.length) return '';
    const label = uiLanguage === 'fr' ? 'Scores CSF actuels' : 'Current CSF scores';
    return `${label}: ${items.join(', ')}`;
  };

  const buildExplanationPayload = (params, result) => {
    const analysis = result?.parameter_analysis || {
      IL_average: toAverage(params?.IL || []),
      IS_average: toAverage(params?.IS || []),
      IM_average: toAverage(params?.IM || [])
    };

    return {
      language: uiLanguage === 'fr' ? 'French' : 'English',
      scores: buildScoreMap(params),
      prediction: result?.prediction ?? null,
      confidence: result?.confidence ?? null,
      strategy: analysis?.strategy || result?.parameter_analysis?.strategy || null,
      recommendations: result?.recommendations || [],
      averages: {
        IL: analysis.IL_average,
        IS: analysis.IS_average,
        IM: analysis.IM_average
      },
      chart: result?.chart || null,
      performance_table: result?.performance_table || null
    };
  };

  const requestExplanation = async (params, result) => {
    const payload = buildExplanationPayload(params, result);
    const explainMessage = `__EXPLAIN_RESULT__\n${JSON.stringify(payload)}`;
    const response = await fetch(`${API_BASE}/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: explainMessage,
        conversationHistory: [],
        modelConfig: buildModelConfigPayload()
      })
    });

    let data = null;
    try {
      data = await response.json();
    } catch (parseError) {
      throw new Error('Invalid JSON response from backend.');
    }

    if (!response.ok) {
      const errorMessage = data?.error || `Request failed (${response.status}).`;
      throw new Error(errorMessage);
    }

    const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
    if (!answer) {
      throw new Error('Empty response from backend.');
    }

    return answer;
  };

  const openConversation = (conversation) => {
    if (loading) return;
    skipNextSaveRef.current = true; // opening is not a change: keep its place in the list
    activeConvRef.current = conversation.id;
    setActiveConvId(conversation.id);
    setMessages(conversation.messages);
    setInput('');
    navigate('chat');
  };

  const deleteConversation = (id) => {
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (id === activeConvRef.current) startNewConversation();
  };

  const startNewConversation = () => {
    activeConvRef.current = null;
    setActiveConvId(null);
    skipNextSaveRef.current = true;
    setMessages(getIntroMessages());
    setInput('');
    setCalcResult(null);
    setActiveTab('chat');
    setAssistedAssessment({
      active: false,
      stepIndex: 0,
      parameters: createEmptyParameters(),
      review: false
    });
  };

  const submitCalculation = async (paramSet, addToChat = true) => {
    setCalcExplanation('');
    setCalcExplanationLoading(false);
    setLoading(true);
    try {
      const response = await fetch(`${API_BASE}/calculate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parameters: paramSet, language: uiLanguage })
      });

      let data = null;
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error('Invalid JSON response from backend.');
      }
      if (!response.ok) {
        const errorMessage = data?.error || data?.detail || `Request failed (${response.status}).`;
        throw new Error(errorMessage);
      }
      setCalcResult(data);
      setLastCalcParams(paramSet);

      if (addToChat) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Analysis Complete!\n\nPredicted Performance: ${data.prediction?.toFixed(2) || 'N/A'}%\nConfidence: ${data.confidence || 'N/A'}\n\nRecommendations:\n${data.recommendations?.map((r, i) => `${i + 1}. ${r}`).join('\n') || 'Process optimization suggestions based on your parameters.'}`,
          type: 'calculation',
          chart: data.chart,
          performance_table: data.performance_table,
          calcSnapshot: {
            parameters: paramSet,
            result: data
          }
        }]);
      }

      return data;
    } catch (error) {
      const fallbackAnalysis = {
        IL_average: toAverage(paramSet.IL),
        IS_average: toAverage(paramSet.IS),
        IM_average: toAverage(paramSet.IM)
      };
      const fallback = {
        prediction: 'Demo Mode',
        confidence: 'High',
        recommendations: [
          'Focus on improving Implementation parameters (IM)',
          'Strengthen Strategic alignment (IS)',
          'Enhance Leadership support (IL)',
          'Consider cross-functional team training'
        ],
        parameter_analysis: fallbackAnalysis
      };
      setCalcResult(fallback);
      setLastCalcParams(paramSet);

      if (addToChat) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: 'Demo Analysis Complete! Connect to your backend for real predictions.',
          type: 'calculation',
          calcSnapshot: {
            parameters: paramSet,
            result: fallback
          }
        }]);
      }

      return fallback;
    } finally {
      setLoading(false);
    }
  };

  const getAssistedStepLabel = (step) => {
    return csfLevels.labels?.[step.code] || step.label;
  };

  const getAssistedChoices = (step) => {
    const levelMap = csfLevels.levels?.[step.code] || {};
    return DEFAULT_LEVEL_CHOICES.map((choice) => ({
      ...choice,
      detail: levelMap[choice.level] || choice.detail
    }));
  };

  const updateAssistedReviewScore = (group, index, value) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      return;
    }
    setAssistedAssessment((prev) => ({
      ...prev,
      parameters: {
        ...prev.parameters,
        [group]: prev.parameters[group].map((v, i) => (i === index ? String(parsed) : v))
      }
    }));
    setParameters((prev) => ({
      ...prev,
      [group]: prev[group].map((v, i) => (i === index ? String(parsed) : v))
    }));
  };

  const confirmAssistedAssessment = async () => {
    if (loading || !reviewReady) return;
    const updatedParams = assistedAssessment.parameters;
    setAssistedAssessment({
      active: false,
      stepIndex: 0,
      parameters: updatedParams,
      review: false
    });
    setParameters(updatedParams);
    setView('chat');
    setActiveTab('chat');
    setMessages(prev => [...prev, {
      role: 'assistant',
      content: 'Guided assessment complete. Calculating your predicted performance now.'
    }]);
    await submitCalculation(updatedParams, true);
  };

  // The guided assessment has its own view; it no longer writes each step into the chat.
  const startAssistedAssessment = () => {
    if (loading) return;
    setAssistedAssessment({
      active: true,
      stepIndex: 0,
      parameters: createEmptyParameters(),
      review: false
    });
    navigate('guided');
  };

  // Top-bar button: resume an assessment in progress, otherwise start one
  const openGuidedAssessment = () => {
    if (assistedAssessment.active || assistedAssessment.review) {
      navigate('guided');
    } else {
      startAssistedAssessment();
    }
  };

  const goBackAssistedStep = () => {
    setAssistedAssessment((prev) => {
      if (prev.review) return { ...prev, active: true, review: false, stepIndex: ASSISTED_STEPS.length - 1 };
      if (prev.active && prev.stepIndex > 0) return { ...prev, stepIndex: prev.stepIndex - 1 };
      return prev;
    });
  };

  const skipForwardAssistedStep = () => {
    setAssistedAssessment((prev) => {
      const step = ASSISTED_STEPS[prev.stepIndex];
      const answered = prev.parameters[step.group][step.index] !== '';
      if (!prev.active || !answered) return prev;
      if (prev.stepIndex + 1 < ASSISTED_STEPS.length) return { ...prev, stepIndex: prev.stepIndex + 1 };
      return { ...prev, active: false, review: true, stepIndex: 0 };
    });
  };

  const cancelAssistedAssessment = () => {
    setAssistedAssessment({
      active: false,
      stepIndex: 0,
      parameters: createEmptyParameters(),
      review: false
    });
    navigate('chat');
  };

  const applyAssistedScore = async (score) => {
    const currentStep = ASSISTED_STEPS[assistedAssessment.stepIndex];
    const updatedParams = {
      ...assistedAssessment.parameters,
      [currentStep.group]: assistedAssessment.parameters[currentStep.group].map((value, index) =>
        index === currentStep.index ? String(score) : value
      )
    };

    const nextStepIndex = assistedAssessment.stepIndex + 1;
    if (nextStepIndex < ASSISTED_STEPS.length) {
      setAssistedAssessment({
        active: true,
        stepIndex: nextStepIndex,
        parameters: updatedParams,
        review: false
      });
      return;
    }

    setAssistedAssessment({
      active: false,
      stepIndex: 0,
      parameters: updatedParams,
      review: true
    });
    setParameters(updatedParams);
  };

  const handleAssistedInput = async (text) => {
    const normalized = text.trim().toLowerCase();
    if (['cancel', 'stop', 'exit'].includes(normalized)) {
      cancelAssistedAssessment();
      return;
    }

    const currentStep = ASSISTED_STEPS[assistedAssessment.stepIndex];
    const parsed = Number(normalized);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Please enter a whole number between 1 and 5 for ${currentStep.code} - ${getAssistedStepLabel(currentStep)}.`
      }]);
      return;
    }

    await applyAssistedScore(parsed);
  };

  const handleAssistedChoice = async (score) => {
    await applyAssistedScore(score);
  };

  const sendUserMessage = async (rawText, options = {}) => {
    const { clearInput = true } = options;
    const messageText = typeof rawText === 'string' ? rawText.trim() : '';
    if (!messageText) return;

    const detectedLanguage = uiLanguage === 'fr' ? 'fr' : 'en';

    const userMessage = { role: 'user', content: messageText };
    setMessages(prev => [...prev, userMessage]);
    if (clearInput) {
      setInput('');
    }
    setLoading(true);
    setLoadingMessage('Analyzing your question...');

    try {
      const historyPayload = [...messages, userMessage]
        .slice(-10)
        .map(({ role, content }) => ({ role, content }));
      const modelConfigPayload = buildModelConfigPayload();
      // Only send the calculator scores when the question is about them.
      // (Sending them with every message made every answer a score report.)
      const asksAboutScores = /\b(I[LSM]\d|csf|scores?|results?|résultats?|performance|maturit|my (company|organi[sz]ation|profile)|mon entreprise|notre entreprise)/i.test(messageText);
      const scoreContext = asksAboutScores
        ? buildScoreContext(lastCalcParams) || buildScoreContext(parameters)
        : '';
      const queryPayload = scoreContext ? `${messageText}

${scoreContext}` : messageText;
      const response = await fetch(`${API_BASE}/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query: queryPayload,
          language: detectedLanguage,
          conversationHistory: historyPayload,
          modelConfig: modelConfigPayload
        })
      });

      let data = null;
      try {
        data = await response.json();
      } catch (parseError) {
        throw new Error('Invalid JSON response from backend.');
      }

      if (!response.ok) {
        const errorMessage = data?.error || `Request failed (${response.status}).`;
        throw new Error(errorMessage);
      }

      const answer = typeof data?.answer === 'string' ? data.answer.trim() : '';
      if (!answer) {
        throw new Error('Empty response from backend.');
      }

      setMessages(prev => [...prev, {
        role: 'assistant',
        content: answer,
        sources: data.sources || [],
        graph_context: data.graph_context
      }]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `Backend error: ${errorMessage} Please ensure your backend API is running at ${API_BASE}.`
      }]);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  const handleSendMessage = async () => {
    await sendUserMessage(input);
  };

  const getHistoryMeta = (content) => {
    const text = String(content || '').trim();
    const scoreMatch = text.match(/^((IL|IS|IM)\d+)\s*=\s*([1-5])\b/i);
    if (!scoreMatch) {
      return {
        kind: 'prompt',
        tone: 'tone-neutral',
        title: text || 'Message',
        hint: 'Tap to reuse in chat',
        tags: ['Prompt']
      };
    }

    const code = scoreMatch[1].toUpperCase();
    const level = Number(scoreMatch[3]);
    const label = csfLevels.labels?.[code] || ASSISTED_LABELS[code];
    return {
      kind: 'score',
      tone: getFactorToneClass(code),
      title: label || text,
      hint: `Level ${level} score captured`,
      tags: ['Score', code, `L${level}`]
    };
  };

  const handleHistoryInsert = (content) => {
    const text = String(content || '');
    if (!text.trim()) return;
    setActiveTab('chat');
    setInput(text);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const handleHistorySend = (content) => {
    const text = String(content || '');
    if (!text.trim()) return;
    setActiveTab('chat');
    void sendUserMessage(text, { clearInput: false });
  };

  const updatePanelsCollapsed = (next) => {
    panelsCollapsedRef.current = next;
    setPanelsCollapsed(next);
  };

  const handleMessagesScroll = (event) => {
    if (!autoCollapseEnabled) return;
    const scrollTop = event.currentTarget.scrollTop;
    const current = panelsCollapsedRef.current;
    if (!current && scrollTop > 64) {
      updatePanelsCollapsed(true);
    } else if (current && scrollTop < 20) {
      updatePanelsCollapsed(false);
    }
  };

  const handleExplainCalculation = async (params, result, messageIndex = null) => {
    if (!result) return;

    if (messageIndex !== null) {
      setExplainLoadingId(messageIndex);
    } else {
      setCalcExplanationLoading(true);
      setCalcExplanation('');
    }

    try {
      const explanation = await requestExplanation(params, result);
      if (messageIndex !== null) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: explanation,
          type: 'explanation'
        }]);
      } else {
        setCalcExplanation(explanation);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      if (messageIndex !== null) {
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `Explanation error: ${errorMessage}`
        }]);
      } else {
        setCalcExplanation(`Explanation error: ${errorMessage}`);
      }
    } finally {
      if (messageIndex !== null) {
        setExplainLoadingId(null);
      } else {
        setCalcExplanationLoading(false);
      }
    }
  };

  const handleParameterChange = (category, index, value) => {
    if (value === '') {
      setParameters(prev => ({
        ...prev,
        [category]: prev[category].map((v, i) => i === index ? value : v)
      }));
      return;
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 5) {
      return;
    }

    setParameters(prev => ({
      ...prev,
      [category]: prev[category].map((v, i) => i === index ? String(parsed) : v)
    }));
  };

  const calculatePredictions = async () => {
    await submitCalculation(parameters, true);
    setActiveTab('chat');
  };

  const isGuidedFullScreen = assistedAssessment.active || assistedAssessment.review;
  const guidedAnswered = Object.values(assistedAssessment.parameters).flat().filter((v) => v !== '').length;

  const renderGuidedView = () => {
    const { active, review, stepIndex, parameters: answers } = assistedAssessment;
    const step = ASSISTED_STEPS[stepIndex];
    const stepNumber = review ? ASSISTED_STEPS.length : stepIndex + 1;
    const progress = review ? 100 : (stepNumber / ASSISTED_STEPS.length) * 100;
    const currentValue = active ? answers[step.group][step.index] : '';
    return (
      <section className="panel l6s-guided">
        <div className="l6s-guided__head">
          <div>
            <div className="section-label">Guided assessment</div>
            <h2>{review ? 'Review your answers' : `Step ${stepNumber} of ${ASSISTED_STEPS.length}`}</h2>
            <div className="l6s-progress"><i style={{ width: `${progress}%` }} /></div>
          </div>
          <div className="l6s-groups">
            {[['IL', 'Lean · IL'], ['IS', 'Six Sigma · IS'], ['IM', 'Maturity · IM']].map(([key, label]) => (
              <span key={key} className={`l6s-grp-chip${active && step.group === key ? ' is-on' : ''}`}>{label}</span>
            ))}
          </div>
        </div>

        <div className="l6s-guided__body">
          {active && (
            <>
              <div className="l6s-code">{step.code} · {step.group === 'IL' ? 'LEAN' : step.group === 'IS' ? 'SIX SIGMA' : 'MATURITY'}</div>
              <div className="l6s-q" dir="auto">{getAssistedStepLabel(step)}</div>
              <div className="l6s-qsub">Choose the level that best matches your current situation.</div>
              <div className="l6s-levels">
                {getAssistedChoices(step).map((choice) => (
                  <button
                    key={`${step.code}-${choice.level}`}
                    type="button"
                    disabled={loading}
                    onClick={() => handleAssistedChoice(choice.level)}
                    className={`l6s-lvl${currentValue === String(choice.level) ? ' is-sel' : ''}`}
                  >
                    <span className="l6s-n">{choice.level}</span>
                    <div>
                      <b>{choice.title}</b>
                      <span dir="auto">{choice.detail}</span>
                    </div>
                  </button>
                ))}
              </div>
            </>
          )}

          {review && (
            <>
              <div className="l6s-qsub">Adjust any score before calculating.</div>
              <div className="l6s-review">
                {[
                  { key: 'IL', title: 'Lean (IL)' },
                  { key: 'IS', title: 'Six Sigma (IS)' },
                  { key: 'IM', title: 'Maturity (IM)' }
                ].map((section) => (
                  <div key={section.key}>
                    <span className="l6s-lbl">{section.title}</span>
                    {Array.from({ length: 7 }).map((_, idx) => {
                      const code = `${section.key}${idx + 1}`;
                      const label = csfLevels.labels?.[code] || ASSISTED_LABELS[code] || code;
                      return (
                        <div key={code} className="l6s-review__row">
                          <div>
                            <b style={{ fontSize: 13 }}>{code}</b>
                            <small dir="auto">{label}</small>
                          </div>
                          <select
                            value={answers?.[section.key]?.[idx] || ''}
                            onChange={(e) => updateAssistedReviewScore(section.key, idx, e.target.value)}
                            className="l6s-select"
                          >
                            <option value="" disabled>--</option>
                            {[1, 2, 3, 4, 5].map((level) => (
                              <option key={level} value={level}>Level {level}</option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        <div className="l6s-guided__foot">
          <div className="l6s-row" style={{ marginTop: 0 }}>
            <button type="button" className="button-secondary" onClick={() => navigate('chat')}>
              <ArrowLeft className="w-4 h-4" /> Back to chat
            </button>
            <button type="button" className="l6s-linkbtn" onClick={cancelAssistedAssessment}>Cancel assessment</button>
          </div>
          <div className="l6s-row" style={{ marginTop: 0 }}>
            <button type="button" className="button-secondary" onClick={goBackAssistedStep} disabled={active && stepIndex === 0}>
              Previous
            </button>
            {active ? (
              <button type="button" className="button-primary" onClick={skipForwardAssistedStep} disabled={currentValue === ''}>
                Next
              </button>
            ) : (
              <button type="button" className="button-primary" onClick={confirmAssistedAssessment} disabled={!reviewReady || loading}>
                Confirm &amp; calculate
              </button>
            )}
          </div>
        </div>
      </section>
    );
  };

  return (
    <div className="app-shell" data-theme={themeMode}>
      <div className="ambient-layer">
        <span className="ambient-blob ambient-blob--a" />
        <span className="ambient-blob ambient-blob--b" />
        <span className="ambient-blob ambient-blob--c" />
        <span className="ambient-grid" />
      </div>
      <div className="app-frame">
        {showIntro && (
          <div className="intro-screen">
            <div className="intro-orb intro-orb--a" />
            <div className="intro-orb intro-orb--b" />
            <div className="intro-orb intro-orb--c" />
            <div className="intro-logo text-center">
              <div className="intro-kicker">AI-Driven Lean Six Sigma</div>
              <div className="intro-title">Performance Engine</div>
              <div className="intro-subtitle">IA-Guided industrial performance management</div>
              <div className="intro-dots">
                <span className="intro-dot" />
                <span className="intro-dot" />
                <span className="intro-dot" />
              </div>
            </div>
          </div>
        )}

        <div className="l6s-shell">
        <div className="l6s-maincol">
        <header className="topbar panel l6s-topbar">
          <button type="button" className="l6s-brand" onClick={() => navigate('chat')} title="Home">
            <div className="brand-mark">
              <TrendingUp className="w-6 h-6" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="brand-kicker">AI-Driven Lean Six Sigma</div>
              <h1 className="brand-title">Operational Excellence Performance Engine</h1>
              <div className="brand-chips">
                <span className="chip">GraphRAG</span>
                <span className="chip">Guided</span>
                <span className="chip">Predictive</span>
              </div>
            </div>
          </button>
          <div className="l6s-actions">
            <button
              type="button"
              onClick={openGuidedAssessment}
              disabled={loading}
              className={`button-primary l6s-cta${view === 'guided' ? ' is-active' : ''}`}
            >
              <ClipboardCheck className="w-4 h-4" />
              {isGuidedFullScreen && view !== 'guided' ? `Resume assessment (${guidedAnswered}/21)` : 'Start Guided Assessment'}
            </button>
            <div className="mode-switch">
              <button
                type="button"
                onClick={() => { navigate('chat'); setActiveTab('chat'); }}
                aria-pressed={view === 'chat' && activeTab === 'chat'}
                className={`mode-button ${view === 'chat' && activeTab === 'chat' ? 'is-active' : ''}`}
              >
                <MessageSquare className="w-4 h-4" /> Chat
              </button>
              <button
                type="button"
                onClick={() => { navigate('chat'); setActiveTab('calculator'); }}
                aria-pressed={view === 'chat' && activeTab === 'calculator'}
                className={`mode-button ${view === 'chat' && activeTab === 'calculator' ? 'is-active' : ''}`}
              >
                <Calculator className="w-4 h-4" /> Calculator
              </button>
            </div>
            <button
              type="button"
              className={`l6s-mobile-me l6s-ava${isAdmin ? '' : ' is-user'}`}
              style={{ width: 40, height: 40 }}
              onClick={() => setSidebarExpanded(true)}
              title="Menu"
            >
              {(currentUser?.name || currentUser?.username || 'U')[0].toUpperCase()}
            </button>
          </div>
        </header>

        <div className="l6s-body">
          {view === 'companies' && isAdmin ? (
            <div className="l6s-main">
              <CompaniesPage onHome={() => navigate('chat')} />
            </div>
          ) : view === 'users' && isAdmin ? (
            <div className="l6s-main">
              <UsersPage usersApi={usersApi} currentUser={currentUser} onHome={() => navigate('chat')} showToast={showToast} />
            </div>
          ) : (
          <>
          <aside className="sidebar panel hidden md:flex md:w-72 flex-col min-h-0">
            <div className="px-4 py-4 border-b panel-divider">
              <div className="section-label">Logbook</div>
              <div className="mt-2 text-sm font-semibold">Conversation History</div>
              <button
                type="button"
                onClick={startNewConversation}
                className="button-primary mt-4 w-full"
              >
                New Conversation
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-2 min-h-0">
              {conversations.length === 0 ? (
                <div className="text-sm text-muted">No conversations yet.</div>
              ) : (
                conversations.map((conv) => {
                  const count = conv.messages.filter((m) => m.role === 'user').length;
                  return (
                    <div key={conv.id} className={`history-item tone-neutral${conv.id === activeConvId ? ' is-active' : ''}`}>
                      <button
                        type="button"
                        onClick={() => openConversation(conv)}
                        className="history-main"
                        aria-label={`Open ${conv.title}`}
                      >
                        <div className="history-meta">
                          <span className="history-pill">{conv.id === activeConvId ? 'Open' : 'Chat'}</span>
                        </div>
                        <div className="history-title truncate" dir="auto" title={conv.title}>
                          {conv.title}
                        </div>
                        <div className="history-snippet truncate">
                          {count} {count === 1 ? 'question' : 'questions'} · {timeAgo(conv.updatedAt)}
                        </div>
                      </button>
                      <div className="history-actions">
                        <button
                          type="button"
                          onClick={() => deleteConversation(conv.id)}
                          className="history-action"
                          aria-label="Delete conversation"
                          title="Delete conversation"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          <div className="l6s-main">
            {view === 'guided' && isGuidedFullScreen ? renderGuidedView() : activeTab === 'chat' ? (
              <div className="panel flex flex-col h-full min-h-0">
                <div className="l6s-status">
                  <span className="l6s-pill"><span className="l6s-dot" />{activeModelLabel}</span>
                  {isGuidedFullScreen ? (
                    <button type="button" className="l6s-pill" onClick={() => navigate('guided')}>
                      Guided assessment: {guidedAnswered}/21 · Resume
                    </button>
                  ) : (
                    <span className="l6s-pill">Guided assessment: not started</span>
                  )}
                </div>

                {/* Messages */}
                <div
                  ref={messagesContainerRef}
                  onScroll={handleMessagesScroll}
                  className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0"
                >
                  {messages.map((msg, idx) => {
                    const chartData = msg.chart || msg.graph_context?.chart;
                    const performanceTable = msg.performance_table || msg.graph_context?.performance_table;
                    const targetActionTable = msg.target_action_table || msg.graph_context?.target_action_table;
                    return (
                      <div
                        key={idx}
                        className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-2xl message-bubble ${
                            msg.role === 'user' ? 'message-bubble--user' : 'message-bubble--assistant'
                          }`}
                        >
                          <p className="whitespace-pre-wrap" dir="auto">{msg.content}</p>
                          {msg.sources && msg.sources.length > 0 && (
                            <div className="mt-2 pt-2 border-t panel-divider">
                              <p className="text-xs text-muted">
                                Sources: {msg.sources.join(', ')}
                              </p>
                            </div>
                          )}
                          {msg.type === 'calculation' && msg.calcSnapshot && (
                            <div className="mt-3">
                              <button
                                type="button"
                                onClick={() => handleExplainCalculation(
                                  msg.calcSnapshot.parameters,
                                  msg.calcSnapshot.result,
                                  idx
                                )}
                                disabled={explainLoadingId === idx || loading}
                                className="button-secondary"
                              >
                                {explainLoadingId === idx ? 'Explaining...' : 'Explain this result'}
                              </button>
                            </div>
                          )}
                          {msg.role !== 'user' && renderChartBlock(chartData)}
                          {msg.role !== 'user' && renderPerformanceTable(performanceTable)}
                          {msg.role !== 'user' && renderTargetActionTable(targetActionTable)}
                          {msg.role !== 'user' && msg.calcSnapshot && renderLevelUpTable(msg.calcSnapshot.parameters)}
                        </div>
                      </div>
                    );
                  })}
                  {loading && (
                    <div className="flex justify-start">
                      <div className="message-bubble message-bubble--assistant">
                        <div className="flex items-center gap-2">
                          <Loader2 className="w-5 h-5 animate-spin text-muted" />
                          <span className="text-sm text-muted">
                            {loadingMessage || 'Thinking...'}
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                {/* Input */}
                <div className="input-bar panel">
                  <div className="flex gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyPress={(e) => e.key === 'Enter' && handleSendMessage()}
                      placeholder="Ask about DMAIC, process capability, or start a guided assessment."
                      className="input-field input-field--chat flex-1"
                      disabled={loading}
                      dir="auto"
                    />
                    <button
                      type="button"
                      onClick={handleSendMessage}
                      disabled={loading || !input.trim()}
                      className="button-primary send-button"
                    >
                      <Send className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="h-full overflow-y-auto p-6 min-h-0">
                <div
                  className={`max-w-5xl mx-auto rounded-xl shadow-xl p-6 border ${themeClass(
                    'bg-slate-900/80 border-slate-800',
                    'bg-white border-slate-200'
                  )}`}
                >
                  <h2 className={`text-2xl font-bold mb-6 ${themeClass('text-slate-100', 'text-slate-900')}`}>
                    Parameter Calculator
                  </h2>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
                    {/* IL Parameters */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold flex items-center gap-2 text-accent">
                        <AlertCircle className="w-5 h-5" />
                        Implementation of Lean (IL)
                      </h3>
                      {[1, 2, 3, 4, 5, 6, 7].map(i => (
                        <div key={i}>
                          <label className={`block text-sm font-medium mb-1 ${themeClass('text-slate-300', 'text-slate-700')}`}>
                            IL{i}
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="5"
                            step="1"
                            inputMode="numeric"
                            value={parameters.IL[i - 1]}
                            onChange={(e) => handleParameterChange('IL', i - 1, e.target.value)}
                            placeholder="1 - 5"
                            className="input-field input-field--compact"
                          />
                        </div>
                      ))}
                    </div>

                    {/* IS Parameters */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold flex items-center gap-2 text-accent-2">
                        <TrendingUp className="w-5 h-5" />
                        Implementation of Six Sigma (IS)
                      </h3>
                      {[1, 2, 3, 4, 5, 6, 7].map(i => (
                        <div key={i}>
                          <label className={`block text-sm font-medium mb-1 ${themeClass('text-slate-300', 'text-slate-700')}`}>
                            IS{i}
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="5"
                            step="1"
                            inputMode="numeric"
                            value={parameters.IS[i - 1]}
                            onChange={(e) => handleParameterChange('IS', i - 1, e.target.value)}
                            placeholder="1 - 5"
                            className="input-field input-field--compact"
                          />
                        </div>
                      ))}
                    </div>

                    {/* IM Parameters */}
                    <div className="space-y-4">
                      <h3 className="text-lg font-semibold flex items-center gap-2 text-accent-3">
                        <Calculator className="w-5 h-5" />
                        Maturity Levels (IM)
                      </h3>
                      {[1, 2, 3, 4, 5, 6, 7].map(i => (
                        <div key={i}>
                          <label className={`block text-sm font-medium mb-1 ${themeClass('text-slate-300', 'text-slate-700')}`}>
                            IM{i}
                          </label>
                          <input
                            type="number"
                            min="1"
                            max="5"
                            step="1"
                            inputMode="numeric"
                            value={parameters.IM[i - 1]}
                            onChange={(e) => handleParameterChange('IM', i - 1, e.target.value)}
                            placeholder="1 - 5"
                            className="input-field input-field--compact"
                          />
                        </div>
                      ))}
                    </div>
                  </div>

                  <button
                    onClick={calculatePredictions}
                    disabled={loading}
                    className="w-full py-4 cta-button text-slate-900 text-lg font-semibold rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <Loader2 className="w-5 h-5 animate-spin" />
                        Calculating...
                      </>
                    ) : (
                      <>
                        <TrendingUp className="w-5 h-5" />
                        Calculate Predictions & Get Recommendations
                      </>
                    )}
                  </button>

                  {calcResult && (
                    <div className={`mt-8 rounded-xl border p-5 ${themeClass(
                      'border-slate-800 bg-slate-900/70',
                      'border-slate-200 bg-white'
                    )}`}>
                      <div className="flex flex-col gap-4">
                        <div>
                          <div className={`text-sm ${themeClass('text-slate-400', 'text-slate-500')}`}>Predicted Performance</div>
                          <div className={`text-3xl font-semibold ${themeClass('text-slate-100', 'text-slate-900')}`}>
                            {typeof calcResult.prediction === 'number'
                              ? `${calcResult.prediction.toFixed(1)}%`
                              : calcResult.prediction}
                          </div>
                        </div>

                        <div className={`h-3 w-full overflow-hidden rounded-full ${themeClass('bg-slate-800', 'bg-slate-200')}`}>
                          <div
                            className="h-full rounded-full bg-accent transition-all"
                            style={{
                              width: `${Math.min(
                                Math.max(Number(calcResult.prediction) || 0, 0),
                                100
                              )}%`
                            }}
                          />
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-6">
                          <div className={`rounded-lg p-4 ${themeClass('bg-slate-900/80', 'bg-slate-50')}`}>
                            <div className={`text-xs uppercase tracking-wide ${themeClass('text-slate-400', 'text-slate-500')}`}>
                              Radar Summary
                            </div>
                            <div className="mt-3 flex items-center justify-center">
                              <svg width={radarSize} height={radarSize}>
                                <polygon
                                  points={radarAxisPoints}
                                  fill="none"
                                  stroke={radarColors.grid}
                                  strokeWidth="1"
                                />
                                <polygon
                                  points={radarPoints}
                                  fill={radarColors.fill}
                                  stroke={radarColors.stroke}
                                  strokeWidth="2"
                                />
                              </svg>
                            </div>
                            <div className={`mt-3 grid grid-cols-3 gap-2 text-xs ${themeClass('text-slate-400', 'text-slate-500')}`}>
                              {radarValues.map((item) => (
                                <div key={item.label} className={`text-center ${themeClass('text-slate-400', 'text-slate-500')}`}>
                                  {item.label}
                                </div>
                              ))}
                            </div>
                          </div>

                          <div className="grid grid-cols-3 gap-4">
                            {[
                            { label: 'IL', value: analysis.IL_average, color: 'bg-accent' },
                            { label: 'IS', value: analysis.IS_average, color: 'bg-accent-2' },
                            { label: 'IM', value: analysis.IM_average, color: 'bg-accent-3' }
                          ].map((item) => (
                              <div
                                key={item.label}
                                className={`rounded-lg p-3 shadow-sm ${themeClass('bg-slate-900/80', 'bg-slate-50')}`}
                              >
                                <div className={`text-xs uppercase tracking-wide ${themeClass('text-slate-400', 'text-slate-500')}`}>
                                  {item.label} Avg
                                </div>
                                <div className="mt-2 flex items-end gap-2">
                                  <div
                                    className={`w-8 rounded-md ${item.color}`}
                                    style={{ height: `${(item.value || 0) * 18}px` }}
                                  />
                                  <div className={`text-lg font-semibold ${themeClass('text-slate-200', 'text-slate-700')}`}>
                                    {(item.value || 0).toFixed(2)}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>

                        {hasAnyParameter && (
                          <div className="mt-6">
                            <div className={`text-xs uppercase tracking-[0.3em] ${themeClass('text-slate-400', 'text-slate-500')}`}>
                              Parameter Profile
                            </div>
                            <div className="mt-4 space-y-4">
                              {[
                                { label: 'Lean (IL)', key: 'IL', color: 'bg-accent', values: parameters.IL },
                                { label: 'Six Sigma (IS)', key: 'IS', color: 'bg-accent-2', values: parameters.IS },
                                { label: 'Maturity (IM)', key: 'IM', color: 'bg-accent-3', values: parameters.IM }
                              ].map((group) => (
                                <div
                                  key={group.key}
                                  className={`rounded-lg p-3 shadow-sm ${themeClass('bg-slate-900/80', 'bg-slate-50')}`}
                                >
                                  <div className={`flex items-center justify-between text-xs ${themeClass('text-slate-400', 'text-slate-500')}`}>
                                    <span className={`font-semibold ${themeClass('text-slate-200', 'text-slate-700')}`}>
                                      {group.label}
                                    </span>
                                    <span>1-5</span>
                                  </div>
                                  <div className="mt-3 grid grid-cols-7 gap-2">
                                    {group.values.map((value, idx) => {
                                      const normalized = Math.max(0, Math.min(1, (Number(value) || 0) / 5));
                                      return (
                                        <div key={`${group.key}-${idx}`} className="flex flex-col items-center gap-2">
                                          <div className={`flex h-20 w-full items-end rounded-lg ${themeClass('bg-slate-800', 'bg-slate-200')}`}>
                                            <div
                                              className={`w-full rounded-lg ${group.color} transition-all`}
                                              style={{ height: `${normalized * 100}%` }}
                                            />
                                          </div>
                                          <div className={`text-[11px] ${themeClass('text-slate-400', 'text-slate-500')}`}>
                                            {group.key}{idx + 1}
                                          </div>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {renderChartBlock(calcResult?.chart, 'Detailed CSF Profile')}
                        {renderPerformanceTable(calcResult?.performance_table)}
                        {renderLevelUpTable(lastCalcParams)}
                        <div className={`mt-6 rounded-xl border p-4 ${themeClass('border-slate-800 bg-slate-900/80', 'border-slate-200 bg-white')}`}>
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div>
                              <div className={`text-xs uppercase tracking-wide ${themeClass('text-slate-400', 'text-slate-500')}`}>
                                AI Explanation
                              </div>
                              <div className={`mt-1 text-sm font-semibold ${themeClass('text-slate-100', 'text-slate-900')}`}>
                                Clarify the assessment results
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => handleExplainCalculation(lastCalcParams, calcResult)}
                              disabled={calcExplanationLoading || loading}
                              className="button-secondary"
                            >
                              {calcExplanationLoading ? 'Explaining...' : 'Explain results'}
                            </button>
                          </div>
                          {calcExplanation && (
                            <div className={`mt-4 rounded-lg p-4 text-sm leading-relaxed ${themeClass('bg-slate-900/80 text-slate-100', 'bg-slate-50 text-slate-700')}`}>
                              <p className="whitespace-pre-wrap" dir="auto">{calcExplanation}</p>
                            </div>
                          )}
                          {!calcExplanation && !calcExplanationLoading && (
                            <div className={`mt-3 text-xs ${themeClass('text-slate-400', 'text-slate-500')}`}>
                              Generate a plain-language explanation with tailored recommendations.
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          </>
          )}
        </div>
        </div>

        <AppSidebar
          currentUser={currentUser}
          isAdmin={isAdmin}
          expanded={sidebarExpanded}
          setExpanded={setSidebarExpanded}
          section={sidebarSection}
          setSection={setSidebarSection}
          view={view}
          navigate={navigate}
          llm={{
            modelConfig,
            updateModelConfig,
            activeModelLabel,
            runApiTest,
            apiTestState,
            apiTestBadge,
            localModelOptions: LOCAL_MODEL_OPTIONS
          }}
          isDark={isDark}
          onToggleTheme={() => setThemeMode(isDark ? 'light' : 'dark')}
          onLogout={handleLogout}
          usersApi={usersApi}
          usageRefreshKey={messages.length}
        />
        </div>
      </div>
      {toast && (
        <div className={`l6s-toast${toast.isError ? ' is-error' : ''}`}>
          <span className={`l6s-dot${toast.isError ? ' is-off' : ''}`} />{toast.text}
        </div>
      )}
    </div>
  );
};

export default LeanSixSigmaChatbot;



