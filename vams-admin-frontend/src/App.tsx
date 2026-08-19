import React, { useState, useEffect, useMemo } from 'react';
import axios from 'axios';
import { io } from 'socket.io-client';
import { 
  ShieldAlert, 
  Activity, 
  Users, 
  CheckCircle, 
  Settings, 
  PlusCircle, 
  LogOut, 
  Building, 
  AlertTriangle,
  Bell,
  Search,
  X,
  RefreshCw,
  User,
  Clock
} from 'lucide-react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';
axios.defaults.baseURL = API_BASE_URL;

// Add token interceptor to axios
axios.interceptors.request.use((config) => {
  const token = localStorage.getItem('vams_admin_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  const companyId = localStorage.getItem('vams_admin_selected_company_id');
  if (companyId && companyId !== 'all') {
    config.headers['x-company-id'] = companyId;
  }
  return config;
}, (err) => Promise.reject(err));

// Add response interceptor to handle token expiry / unauthorized errors automatically
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      localStorage.removeItem('vams_admin_token');
      localStorage.removeItem('vams_admin_selected_company_id');
      window.location.reload();
    }
    return Promise.reject(error);
  }
);

interface AlertSummary {
  totalDefects: number;
  openDefects: number;
  resolvedDefects: number;
  reopenedDefects: number;
  reassignedDefects: number;
}

interface UserPerformance {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  companyId?: string;
  companyName?: string;
  currentlyAssigned: number;
  resolvedCount: number;
  reopenedCount: number;
  reassignedCount: number;
}

interface AuditTimelineEvent {
  id: string;
  alertId: string;
  actionType: string;
  details: string;
  createdAt: string;
  operator: string;
}

interface CompanyData {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  settings: {
    maxUsers: number;
    allowedRoles: string[];
    whatsappEnabled: boolean;
    whatsappApiKey: string | null;
    whatsappSenderNum: string | null;
    soundEmergency: string;
  } | null;
  users: UserPerformance[];
  alerts: {
    id: string;
    vin: string;
    defectName: string;
    severity: string;
    status: string;
    assignedToUserId: string | null;
    assignedToUser: { id: string; name: string; role: string; } | null;
    createdAt: string;
    updatedAt: string;
    escalationStep: number;
    nextEscalationAt: string | null;
  }[];
}

// COMMON_DEFECTS removed


export default function App() {
  // Authentication State
  const [token, setToken] = useState<string | null>(localStorage.getItem('vams_admin_token'));
  const [userProfile, setUserProfile] = useState<any>(null);
  
  // Login fields
  const [loginTab, setLoginTab] = useState<'tenant' | 'global'>('tenant');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companyIdOrName, setCompanyIdOrName] = useState('');
  const [authError, setAuthError] = useState('');
  
  // Super Admin - Companies list & selector
  const [companies, setCompanies] = useState<any[]>([]);
  const [selectedCompanyId, setSelectedCompanyId] = useState<string | null>(localStorage.getItem('vams_admin_selected_company_id'));

  const selectedCompanyName = selectedCompanyId === 'all'
    ? 'Global'
    : (companies.find(c => c.id === selectedCompanyId)?.name || userProfile?.companyCode || userProfile?.companyName || 'Tenant');

  // Interactive UI State for Multi-Tenant Workspace
  const [expandedCompanyId, setExpandedCompanyId] = useState<string | null>(null);
  const [companySubTab, setCompanySubTab] = useState<'users' | 'tasks' | 'policies'>('users');

  // Company creation form state
  const [newCompanyName, setNewCompanyName] = useState('');
  const [newCompanyMaxUsers, setNewCompanyMaxUsers] = useState(0);
  const [newCompanySuccess, setNewCompanySuccess] = useState('');
  const [newCompanyError, setNewCompanyError] = useState('');

  // Dashboard Data
  const [analytics, setAnalytics] = useState<{
    summary: AlertSummary;
    severityDistribution: Record<string, number>;
    categoryDistribution: Record<string, number>;
    userPerformance: UserPerformance[];
    companiesData?: CompanyData[];
    auditTimeline: AuditTimelineEvent[];
  } | null>(null);

  const [activeTab, setActiveTab] = useState<'overview' | 'dispatch' | 'users' | 'policy' | 'companies' | 'alerts' | 'ai-clustering'>('overview');

  // Telemetry Modal Inspector State
  const [telemetryModalOpen, setTelemetryModalOpen] = useState(false);
  const [telemetryFilter, setTelemetryFilter] = useState<'ALL' | 'OPEN' | 'RESOLVED' | 'REOPENED' | 'REASSIGNED'>('ALL');
  const [allFetchedAlerts, setAllFetchedAlerts] = useState<any[]>([]);
  const [telemetrySearch, setTelemetrySearch] = useState('');
  const [isLoadingTelemetryAlerts, setIsLoadingTelemetryAlerts] = useState(false);

  const handleTelemetryCardClick = async (filterType: 'ALL' | 'OPEN' | 'RESOLVED' | 'REOPENED' | 'REASSIGNED') => {
    setTelemetryFilter(filterType);
    setTelemetryModalOpen(true);
    setIsLoadingTelemetryAlerts(true);
    try {
      const res = await axios.get('/alerts');
      if (Array.isArray(res.data)) {
        setAllFetchedAlerts(res.data);
      } else {
        console.error('Invalid telemetry alerts response format:', res.data);
        if (analytics?.companiesData && Array.isArray(analytics.companiesData)) {
          const aggregated = analytics.companiesData.flatMap(c => 
            Array.isArray(c.alerts) ? c.alerts.map(a => ({ ...a, company: { name: c.name } })) : []
          );
          setAllFetchedAlerts(aggregated);
        }
      }
    } catch (err) {
      console.error('Failed to fetch telemetry alerts list:', err);
      if (analytics?.companiesData && Array.isArray(analytics.companiesData)) {
        const aggregated = analytics.companiesData.flatMap(c => 
          Array.isArray(c.alerts) ? c.alerts.map(a => ({ ...a, company: { name: c.name } })) : []
        );
        setAllFetchedAlerts(aggregated);
      }
    } finally {
      setIsLoadingTelemetryAlerts(false);
    }
  };

  const filteredTelemetryAlerts = useMemo(() => {
    let list = [...allFetchedAlerts];
    if (telemetryFilter === 'OPEN') {
      list = list.filter(a => a.status === 'OPEN' || a.status === 'IN_PROGRESS');
    } else if (telemetryFilter === 'RESOLVED') {
      list = list.filter(a => a.status === 'RESOLVED');
    } else if (telemetryFilter === 'REOPENED') {
      list = list.filter(a => a.status === 'REOPENED');
    } else if (telemetryFilter === 'REASSIGNED') {
      list = list.filter(a => a.status === 'REASSIGNED' || (a.assignments && a.assignments.length > 1) || a.isManual);
    }

    if (telemetrySearch.trim()) {
      const q = telemetrySearch.toLowerCase();
      list = list.filter(a => 
        (a.vin && a.vin.toLowerCase().includes(q)) ||
        (a.defectName && a.defectName.toLowerCase().includes(q)) ||
        (a.severity && a.severity.toLowerCase().includes(q)) ||
        (a.status && a.status.toLowerCase().includes(q)) ||
        (a.assignedToUser?.name && a.assignedToUser.name.toLowerCase().includes(q)) ||
        (a.company?.name && a.company.name.toLowerCase().includes(q))
      );
    }
    return list;
  }, [allFetchedAlerts, telemetryFilter, telemetrySearch]);

  // Manual Dispatch State
  const [manualAssigneeId, setManualAssigneeId] = useState('');
  const [manualSeverity, setManualSeverity] = useState('MEDIUM');
  const [manualCompanyId, setManualCompanyId] = useState('');
  const [manualNotes, setManualNotes] = useState('');
  const [dispatchSuccess, setDispatchSuccess] = useState('');
  const [dispatchError, setDispatchError] = useState('');

  // Alert Definitions & Broadcast State
  const [definitions, setDefinitions] = useState<any[]>([]);
  const [defectMasters, setDefectMasters] = useState<any[]>([]);
  const [broadcasts, setBroadcasts] = useState<any[]>([]);
  const [editingDef, setEditingDef] = useState<any | null>(null);
  const [defAlertId, setDefAlertId] = useState('');
  const [defName, setDefName] = useState('');
  const [defDesc, setDefDesc] = useState('');
  const [defType, setDefType] = useState('Safety');
  const [defSeverity, setDefSeverity] = useState('MEDIUM');
  const [defPrimaryAssignee, setDefPrimaryAssignee] = useState('');
  const [defEscalationChain, setDefEscalationChain] = useState<string[]>([]);
  const [defEscalationTimeout, setDefEscalationTimeout] = useState<number>(30);
  const [defCriticalOverride, setDefCriticalOverride] = useState(false);
  const [alertError, setAlertError] = useState('');
  const [alertSuccess, setAlertSuccess] = useState('');
  const [alertSearch, setAlertSearch] = useState('');
  const [alertSeverityFilter, setAlertSeverityFilter] = useState('ALL');

  // Manual Dispatch - Alert Definition select
  const [manualAlertDefinitionId, setManualAlertDefinitionId] = useState('');

  // System Roles for Role-Based Notifications & Escalation Chains
  const SYSTEM_ROLES = [
    { id: 'role_COMPANY_ADMIN', role: 'COMPANY_ADMIN', label: 'Company Admin (All Admins)' },
    { id: 'role_SUPERVISOR', role: 'SUPERVISOR', label: 'Supervisor (All Supervisors)' },
    { id: 'role_FACTORY_MANAGER', role: 'FACTORY_MANAGER', label: 'Factory Manager (All Managers)' },
    { id: 'role_SERVICE_ENGINEER', role: 'SERVICE_ENGINEER', label: 'Service Engineer (All Engineers)' },
    { id: 'role_WORKER', role: 'WORKER', label: 'Worker / Operator (All Workers)' },
    { id: 'role_QUALITY_INSPECTOR', role: 'QUALITY_INSPECTOR', label: 'Quality Inspector (All Inspectors)' },
  ];

  // Broadcast Message State
  const [broadcastTitle, setBroadcastTitle] = useState('');
  const [broadcastMessage, setBroadcastMessage] = useState('');
  const [broadcastTargetUserIds, setBroadcastTargetUserIds] = useState<string[]>([]);
  const [broadcastTargetRoles, setBroadcastTargetRoles] = useState<string[]>([]);
  const [broadcastSuccess, setBroadcastSuccess] = useState('');
  const [broadcastError, setBroadcastError] = useState('');
  const [isSavingAlert, setIsSavingAlert] = useState(false);
  const [isSendingBroadcast, setIsSendingBroadcast] = useState(false);

  // Policy Forms State
  const [policyMaxUsers, setPolicyMaxUsers] = useState(0);
  const [policyAllowedRoles, setPolicyAllowedRoles] = useState<string[]>([]);
  const [policyWhatsappEnabled, setPolicyWhatsappEnabled] = useState(false);
  const [policyWhatsappApiKey, setPolicyWhatsappApiKey] = useState('');
  const [policyWhatsappSenderNum, setPolicyWhatsappSenderNum] = useState('');
  const [policyTier, setPolicyTier] = useState<string>('BASIC');
  const [policyRulebook, setPolicyRulebook] = useState<any>({});
  const [policyIsActive, setPolicyIsActive] = useState<boolean>(true);

  // Python Defect Diagnostics State
  const [pythonRawDefects, setPythonRawDefects] = useState<any[]>([]);
  const [pythonCleanedDefects, setPythonCleanedDefects] = useState<any[]>([]);
  const [pythonGroupedDefects, setPythonGroupedDefects] = useState<any[]>([]);
  const [pythonStatus, setPythonStatus] = useState<any>(null);
  const [isFetchingPythonData, setIsFetchingPythonData] = useState(false);
  const [pythonActionLoading, setPythonActionLoading] = useState<string | null>(null);
  const [pythonSubTab, setPythonSubTab] = useState<'grouped' | 'cleaned' | 'raw'>('grouped');

  const fetchPythonData = async () => {
    setIsFetchingPythonData(true);
    try {
      const [rawRes, cleanedRes, groupedRes, statusRes] = await Promise.all([
        axios.get('/alerts/python-raw'),
        axios.get('/alerts/python-cleaned'),
        axios.get('/alerts/python-grouped'),
        axios.get('/alerts/python-status')
      ]);
      setPythonRawDefects(Array.isArray(rawRes.data) ? rawRes.data : []);
      setPythonCleanedDefects(Array.isArray(cleanedRes.data) ? cleanedRes.data : []);
      setPythonGroupedDefects(Array.isArray(groupedRes.data) ? groupedRes.data : []);
      setPythonStatus(statusRes.data);
    } catch (err) {
      console.error('Failed to fetch Python data:', err);
    } finally {
      setIsFetchingPythonData(false);
    }
  };

  const handleRunPythonClean = async () => {
    setPythonActionLoading('cleaning');
    try {
      const res = await axios.post('/alerts/python-clean');
      alert(res.data.message || 'Cleaner process triggered successfully.');
      setTimeout(() => fetchPythonData(), 2000);
    } catch (err) {
      alert('Failed to trigger cleaner script.');
    } finally {
      setPythonActionLoading(null);
    }
  };

  const handleRunPythonCluster = async () => {
    setPythonActionLoading('clustering');
    try {
      const res = await axios.post('/alerts/python-cluster');
      alert(res.data.message || 'Similarity clustering process triggered successfully.');
      setTimeout(() => fetchPythonData(), 2000);
    } catch (err) {
      alert('Failed to trigger similarity clustering script.');
    } finally {
      setPythonActionLoading(null);
    }
  };

  const [isSyncingDb, setIsSyncingDb] = useState(false);

  const handleSyncPythonToDb = async () => {
    setIsSyncingDb(true);
    try {
      const res = await axios.post('/alerts/python-sync-db');
      alert(res.data.message || 'Defects synchronized to database successfully.');
    } catch (err) {
      alert('Failed to synchronize defects to database.');
    } finally {
      setIsSyncingDb(false);
    }
  };

  // Fetch logged in profile details
  useEffect(() => {
    if (token) {
      try {
        const base64Url = token.split('.')[1];
        const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
            return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
        }).join(''));
        const payload = JSON.parse(jsonPayload);
        setUserProfile(payload);
        
        if (payload.role !== 'SUPER_ADMIN') {
          setSelectedCompanyId(payload.companyId);
          localStorage.setItem('vams_admin_selected_company_id', payload.companyId);
        } else {
          // If Super Admin, default to 'all' if no valid scope is selected
          const storedScope = localStorage.getItem('vams_admin_selected_company_id');
          const scopeVal = storedScope || 'all';
          setSelectedCompanyId(scopeVal);
          localStorage.setItem('vams_admin_selected_company_id', scopeVal);
          fetchCompanies();
        }
      } catch (e) {
        handleLogout();
      }
    }
  }, [token]);
  const [coreBackendUrl, setCoreBackendUrl] = useState<string>('');

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await axios.get('/system/config');
        if (res.data?.coreBackendUrl) {
          let url = res.data.coreBackendUrl;
          const idx = url.indexOf('/api/');
          if (idx !== -1) {
            url = url.substring(0, idx);
          }
          setCoreBackendUrl(url);
          console.log('[Config] Loaded Core Backend URL for WebSocket:', url);
        }
      } catch (err) {
        console.error('[Config] Failed to fetch system config:', err);
      }
    };
    fetchConfig();
  }, []);

  // Real-time socket client connection for instant updates
  useEffect(() => {
    if (!token) return;

    const wsUrl = coreBackendUrl || 'http://127.0.0.1:3000';
    console.log('[Socket] Connecting to core real-time socket server:', wsUrl);
    const socket = io(wsUrl, {
      query: { token },
      transports: ['websocket'],
    });

    socket.on('connect', () => {
      console.log('[Socket] Connected successfully, active socket ID:', socket.id);
    });

    const playNotificationSound = (_data?: any) => {
      // Muted on laptop dashboard by default
      console.log('[Sound] Notification sound muted on laptop dashboard.');
    };

    const refreshDashboard = (data?: any) => {
      console.log('[Socket Event Received] Triggering dashboard telemetry refresh:', data);
      playNotificationSound(data);
      fetchAnalytics();
      if (selectedCompanyId && selectedCompanyId !== 'all') {
        fetchSettings();
        fetchDefinitions();
        fetchBroadcasts();
      }
    };

    // Listen to all real-time lifecycle updates
    socket.on('ALERT_CREATED', refreshDashboard);
    socket.on('ALERT_UPDATED', refreshDashboard);
    socket.on('ALERT_RESOLVED', refreshDashboard);
    socket.on('ALERT_REOPENED', refreshDashboard);
    socket.on('ALERT_ASSIGNED', refreshDashboard);
    socket.on('BROADCAST_CREATED', refreshDashboard);
    socket.on('COMMENT_ADDED', refreshDashboard);

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected from server');
    });

    return () => {
      socket.disconnect();
    };
  }, [token, selectedCompanyId, coreBackendUrl]);

  // Fetch analytics when selectedCompanyId changes and set up a polling interval for real-time dashboard updates
  useEffect(() => {
    if (!token || !selectedCompanyId) return;

    fetchAnalytics();
    fetchDefectMasters();
    if (selectedCompanyId !== 'all') {
      fetchSettings();
      fetchDefinitions();
      fetchBroadcasts();
    }

    const interval = setInterval(() => {
      fetchAnalytics();
    }, 5000); // Poll every 5 seconds for real-time stats updates

    return () => clearInterval(interval);
  }, [token, selectedCompanyId]);

  const fetchCompanies = async () => {
    try {
      const res = await axios.get('/companies');
      if (Array.isArray(res.data)) {
        setCompanies(res.data);
      } else {
        console.error('Invalid companies response format:', res.data);
      }
    } catch (err) {
      console.error('Failed to fetch company list:', err);
    }
  };

  const handleCreateCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    setNewCompanyError('');
    setNewCompanySuccess('');
    if (!newCompanyName.trim()) {
      setNewCompanyError('Company name is required');
      return;
    }
    try {
      const res = await axios.post('/companies', {
        name: newCompanyName,
        settings: {
          maxUsers: newCompanyMaxUsers,
        }
      });
      setNewCompanySuccess(`Company "${res.data.name}" registered successfully!`);
      setNewCompanyName('');
      setNewCompanyMaxUsers(0);
      fetchCompanies();
    } catch (err: any) {
      setNewCompanyError(err.response?.data?.message || 'Failed to create company');
    }
  };

  const toggleCompanyActive = async (id: string, currentStatus: boolean) => {
    try {
      await axios.patch(`/companies/${id}/status`, { isActive: !currentStatus });
      fetchCompanies();
      fetchAnalytics();
    } catch (err) {
      console.error('Failed to toggle company status:', err);
      alert('Failed to update company status');
    }
  };

  const fetchAnalytics = async () => {
    try {
      const res = await axios.get('/alerts/analytics');
      if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
        setAnalytics(res.data);
      } else {
        console.error('Invalid analytics response format:', res.data);
      }
    } catch (err) {
      console.error('Failed to fetch dashboard metrics:', err);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await axios.get('/companies/settings');
      if (res.data && typeof res.data === 'object' && !Array.isArray(res.data)) {
        setPolicyMaxUsers(res.data.maxUsers ?? 0);
        setPolicyAllowedRoles(res.data.allowedRoles || []);
        setPolicyWhatsappEnabled(!!res.data.whatsappEnabled);
        setPolicyWhatsappApiKey(res.data.whatsappApiKey || '');
        setPolicyWhatsappSenderNum(res.data.whatsappSenderNum || '');
        setPolicyTier(res.data.company?.tier || 'BASIC');
        setPolicyIsActive(res.data.company?.isActive !== false);
        setPolicyRulebook(res.data.rulebook || {});
      } else {
        console.error('Invalid settings response format:', res.data);
      }
    } catch (err) {
      console.error('Failed to fetch company configurations:', err);
    }
  };

  const fetchDefinitions = async () => {
    try {
      const res = await axios.get('/alerts/definitions');
      if (Array.isArray(res.data)) {
        setDefinitions(res.data);
      } else {
        console.error('Invalid definitions response format:', res.data);
      }
    } catch (err) {
      console.error('Failed to fetch alert definitions:', err);
    }
  };

  const fetchDefectMasters = async () => {
    try {
      const res = await axios.get('/alerts/defect-masters');
      if (Array.isArray(res.data)) {
        setDefectMasters(res.data);
      } else {
        console.error('Invalid defect masters response format:', res.data);
      }
    } catch (err) {
      console.error('Failed to fetch defect masters:', err);
    }
  };

  const fetchBroadcasts = async () => {
    try {
      const res = await axios.get('/alerts/broadcasts');
      if (Array.isArray(res.data)) {
        setBroadcasts(res.data);
      } else {
        console.error('Invalid broadcasts response format:', res.data);
      }
    } catch (err) {
      console.error('Failed to fetch broadcasts:', err);
    }
  };

  const handleCreateOrUpdateDefinition = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSavingAlert) return;
    setAlertError('');
    setAlertSuccess('');

    if (!defAlertId || !defName || !defType || !defPrimaryAssignee) {
      setAlertError('Alert ID, Alert Name, Category/Type, and Primary Assignee are required.');
      return;
    }

    const payload = {
      alertId: defAlertId,
      name: defName,
      definition: defDesc,
      type: defType,
      severity: defSeverity,
      primaryAssigneeId: defPrimaryAssignee,
      escalationChain: defEscalationChain,
      escalationTimeout: Number(defEscalationTimeout),
      criticalOverride: defCriticalOverride,
    };

    setIsSavingAlert(true);
    try {
      if (editingDef) {
        await axios.put(`/alerts/definitions/${editingDef.id}`, payload);
        setAlertSuccess('Alert definition updated successfully!');
      } else {
        await axios.post('/alerts/definitions', payload);
        setAlertSuccess('Alert definition created successfully!');
      }
      setDefAlertId('');
      setDefName('');
      setDefDesc('');
      setDefType('Safety');
      setDefSeverity('MEDIUM');
      setDefPrimaryAssignee('');
      setDefEscalationChain([]);
      setDefEscalationTimeout(30);
      setDefCriticalOverride(false);
      setEditingDef(null);
      fetchDefinitions();
    } catch (err: any) {
      setAlertError(err.response?.data?.message || 'Failed to save alert definition');
    } finally {
      setIsSavingAlert(false);
    }
  };

  const handleDeleteDefinition = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this alert definition?')) return;
    try {
      await axios.delete(`/alerts/definitions/${id}`);
      fetchDefinitions();
    } catch (err) {
      console.error('Failed to delete alert definition:', err);
      alert('Failed to delete alert definition');
    }
  };

  const handleDeleteBroadcast = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this broadcast audit log entry?')) return;
    try {
      await axios.delete(`/alerts/broadcasts/${id}`);
      fetchBroadcasts();
    } catch (err) {
      console.error('Failed to delete broadcast log:', err);
      alert('Failed to delete broadcast log');
    }
  };



  const handleSendBroadcast = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSendingBroadcast) return;
    setBroadcastError('');
    setBroadcastSuccess('');

    if (!broadcastTitle || !broadcastMessage) {
      setBroadcastError('Title and message are required.');
      return;
    }

    setIsSendingBroadcast(true);
    try {
      await axios.post('/alerts/broadcast', {
        title: broadcastTitle,
        message: broadcastMessage,
        targetUserIds: broadcastTargetUserIds.length > 0 ? broadcastTargetUserIds : undefined,
        targetRoles: broadcastTargetRoles.length > 0 ? broadcastTargetRoles : undefined,
      });
      if (broadcastTargetRoles.length > 0 || broadcastTargetUserIds.length > 0) {
        const targetsSummary = [
          broadcastTargetRoles.length > 0 ? `${broadcastTargetRoles.length} target role(s)` : null,
          broadcastTargetUserIds.length > 0 ? `${broadcastTargetUserIds.length} user(s)` : null,
        ].filter(Boolean).join(' & ');
        setBroadcastSuccess(`Broadcast message dispatched successfully to targeted ${targetsSummary}!`);
      } else {
        setBroadcastSuccess('Broadcast message dispatched successfully to all company operators!');
      }
      setBroadcastTitle('');
      setBroadcastMessage('');
      setBroadcastTargetUserIds([]);
      setBroadcastTargetRoles([]);
      fetchBroadcasts();
    } catch (err: any) {
      setBroadcastError(err.response?.data?.message || 'Failed to dispatch broadcast');
    } finally {
      setIsSendingBroadcast(false);
    }
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await axios.post('/auth/login', {
        email,
        passwordHash: password, // Sent directly as passwordHash in backend schema
        companyIdOrName: loginTab === 'tenant' ? (companyIdOrName || undefined) : undefined,
      });
      const jwtToken = res.data.accessToken;
      localStorage.setItem('vams_admin_token', jwtToken);
      setToken(jwtToken);
    } catch (err: any) {
      setAuthError(err.response?.data?.message || 'Login credentials invalid');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('vams_admin_token');
    localStorage.removeItem('vams_admin_selected_company_id');
    setToken(null);
    setUserProfile(null);
    setSelectedCompanyId(null);
    setAnalytics(null);
    setCompanies([]);
    setLoginTab('tenant');
    setActiveTab('overview');
    setExpandedCompanyId(null);
  };

  const handleManualDispatch = async (e: React.FormEvent) => {
    e.preventDefault();
    setDispatchError('');
    setDispatchSuccess('');

    if (!manualAlertDefinitionId) {
      setDispatchError('Alert Type definition is required');
      return;
    }

    let assignedToUserId: string | undefined = undefined;
    let assignedToRole: string | undefined = undefined;

    if (manualAssigneeId) {
      if (manualAssigneeId.startsWith('user_')) {
        assignedToUserId = manualAssigneeId.replace('user_', '');
      } else if (manualAssigneeId.startsWith('role_')) {
        assignedToRole = manualAssigneeId.replace('role_', '');
      }
    }

    try {
      const headers: Record<string, string> = {};
      if (selectedCompanyId === 'all' && manualCompanyId) {
        headers['x-company-id'] = manualCompanyId;
      }

      const res = await axios.post('/alerts/manual', {
        alertDefinitionId: manualAlertDefinitionId,
        assignedToUserId,
        assignedToRole,
        severity: manualSeverity || undefined,
        notes: manualNotes || undefined,
      }, { headers });
      setDispatchSuccess(`Successfully dispatched manual alert: ${res.data.defectName || 'Alert'}`);
      setManualAlertDefinitionId('');
      setManualAssigneeId('');
      setManualSeverity('MEDIUM');
      setManualCompanyId('');
      setManualNotes('');
      fetchAnalytics();
    } catch (err: any) {
      setDispatchError(err.response?.data?.message || 'Failed to dispatch manual alert');
    }
  };

  const handleUpdatePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    let finalRulebook = policyRulebook;
    if (typeof policyRulebook === 'string') {
      try {
        finalRulebook = JSON.parse(policyRulebook);
      } catch (err) {
        alert('Invalid JSON in Rulebook configuration field. Please correct the syntax before saving.');
        return;
      }
    }
    try {
      await axios.patch('/companies/settings', {
        maxUsers: policyMaxUsers,
        allowedRoles: policyAllowedRoles,
        whatsappEnabled: policyWhatsappEnabled,
        whatsappApiKey: policyWhatsappApiKey || null,
        whatsappSenderNum: policyWhatsappSenderNum || null,
        tier: policyTier,
        isActive: policyIsActive,
        rulebook: finalRulebook,
      });
      alert('Company configurations successfully updated!');
      fetchSettings();
      fetchAnalytics();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to update company policy settings');
    }
  };

  const toggleAllowedRole = (role: string) => {
    if (policyAllowedRoles.includes(role)) {
      setPolicyAllowedRoles(policyAllowedRoles.filter(r => r !== role));
    } else {
      setPolicyAllowedRoles([...policyAllowedRoles, role]);
    }
  };

  const toggleUserStatus = async (userId: string, currentStatus: boolean) => {
    try {
      alert(`User status toggle requested for User ID: ${userId}. Local simulated update only. Setting profile to: ${!currentStatus}`);
    } catch (err) {
      console.error(err);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#07090e] p-6 font-sans">
        <div className="glass-panel p-8 max-w-md w-full border border-white/10 relative overflow-hidden rounded-2xl shadow-2xl">
          <div className="absolute top-[-50px] right-[-50px] w-36 h-36 bg-gradient-to-br from-[#3b82f6] to-[#8b5cf6] rounded-full blur-[40px] opacity-30"></div>
          
          <div className="flex flex-col items-center mb-8">
            <div className="grad-primary p-4 rounded-2xl glow-blue mb-4 flex items-center justify-center shadow-lg">
              <ShieldAlert className="w-8 h-8 text-white animate-pulse" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white mb-2 text-center" style={{ fontFamily: 'var(--font-title)' }}>
              VAMS Universal Admin
            </h1>
            <p className="text-sm text-gray-400 text-center font-medium">
              Multi-tenant telemetry control system & alert dispatch portal
            </p>
          </div>

          {/* Tab selector for Portal login */}
          <div className="flex gap-2 p-1 bg-[#121620] border border-white/5 rounded-xl mb-6">
            <button
              type="button"
              onClick={() => { setLoginTab('tenant'); setCompanyIdOrName(''); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                loginTab === 'tenant'
                  ? 'bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] text-white shadow-lg'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Tenant Portal
            </button>
            <button
              type="button"
              onClick={() => { setLoginTab('global'); setCompanyIdOrName(''); }}
              className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all duration-200 ${
                loginTab === 'global'
                  ? 'bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6] text-white shadow-lg'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              Global Admin Portal
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-5">
            {loginTab === 'tenant' && (
              <div>
                <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Company Name / Tenant ID
                </label>
                <input
                  type="text"
                  required={loginTab === 'tenant'}
                  value={companyIdOrName}
                  onChange={e => setCompanyIdOrName(e.target.value)}
                  placeholder="e.g. Tata Motors, Mahindra, etc."
                  className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#3b82f6] transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Email Address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="admin@company.com"
                className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#3b82f6] transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#3b82f6] transition-all"
              />
            </div>

            {authError && (
              <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-900/50 rounded-xl text-xs text-red-400">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="submit"
              className="w-full btn-premium grad-primary py-3 rounded-xl font-semibold hover:opacity-90 mt-2 text-white shadow-lg"
            >
              Authenticate Admin Portal
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen overflow-hidden bg-[#07090e] flex font-sans text-white">
      {/* Side Navigation bar */}
      <aside className="w-64 bg-[#0a0d14] border-r border-white/5 p-6 flex flex-col justify-between shrink-0 h-full overflow-y-auto">
        <div>
          <div className="flex items-center gap-3 mb-10">
            <div className="grad-primary p-2.5 rounded-xl shadow-md flex items-center justify-center">
              <ShieldAlert className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
                {userProfile?.companyCode || userProfile?.companyName || 'VAMS Admin'}
              </h2>
              <span className="text-[10px] text-gray-500 tracking-widest uppercase font-semibold">
                {userProfile?.role === 'SUPER_ADMIN' ? 'Super Administrator' : 'Tenant Administrator'}
              </span>
            </div>
          </div>

          <nav className="space-y-2">
            <button
              onClick={() => setActiveTab('overview')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'overview' 
                  ? 'bg-gradient-to-r from-[#3b82f6]/10 to-[#8b5cf6]/5 border-l-4 border-[#3b82f6] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Activity className="w-4 h-4" />
              Live Telemetry
            </button>

            {userProfile?.role === 'SUPER_ADMIN' && (
              <button
                onClick={() => { setActiveTab('companies'); fetchCompanies(); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                  activeTab === 'companies' 
                    ? 'bg-gradient-to-r from-[#3b82f6]/10 to-[#8b5cf6]/5 border-l-4 border-[#3b82f6] text-white' 
                    : 'text-gray-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Building className="w-4 h-4" />
                Global Company Matrix
              </button>
            )}

            <button
              onClick={() => setActiveTab('dispatch')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'dispatch' 
                  ? 'bg-gradient-to-r from-[#3b82f6]/10 to-[#8b5cf6]/5 border-l-4 border-[#3b82f6] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <PlusCircle className="w-4 h-4" />
              Manual Alert Dispatch
            </button>

            <button
              onClick={() => { setActiveTab('alerts'); fetchDefinitions(); fetchBroadcasts(); }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'alerts' 
                  ? 'bg-gradient-to-r from-[#3b82f6]/10 to-[#8b5cf6]/5 border-l-4 border-[#3b82f6] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Bell className="w-4 h-4" />
              Alert Management
            </button>

            <button
              onClick={() => { setActiveTab('ai-clustering'); if (pythonRawDefects.length === 0) { fetchPythonData(); } }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'ai-clustering' 
                  ? 'bg-gradient-to-r from-[#3b82f6]/10 to-[#8b5cf6]/5 border-l-4 border-[#3b82f6] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Activity className="w-4 h-4 text-[#8b5cf6]" />
              AI Defect Clustering
            </button>

            <button
              onClick={() => setActiveTab('users')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'users' 
                  ? 'bg-gradient-to-r from-[#3b82f6]/10 to-[#8b5cf6]/5 border-l-4 border-[#3b82f6] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Users className="w-4 h-4" />
              User Performance
            </button>

            <button
              onClick={() => setActiveTab('policy')}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium transition-all ${
                activeTab === 'policy' 
                  ? 'bg-gradient-to-r from-[#3b82f6]/10 to-[#8b5cf6]/5 border-l-4 border-[#3b82f6] text-white' 
                  : 'text-gray-400 hover:text-white hover:bg-white/5'
              }`}
            >
              <Settings className="w-4 h-4" />
              Licensing & Policies
            </button>
          </nav>
        </div>

        <div>
          <div className="flex items-center gap-3 p-3 bg-[#111522] rounded-xl mb-4 border border-white/5">
            <div className="w-8 h-8 rounded-full grad-primary flex items-center justify-center font-bold text-sm text-white shadow-lg">
              {userProfile?.email?.slice(0, 2).toUpperCase()}
            </div>
            <div className="overflow-hidden">
              <p className="text-xs font-semibold text-white truncate">{userProfile?.email}</p>
              <span className="text-[9px] text-[#3b82f6] truncate font-medium">Active Session</span>
            </div>
          </div>

          <button
            onClick={handleLogout}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#ff4d4d]/10 hover:bg-[#ff4d4d]/20 text-[#ff4d4d] text-xs font-semibold rounded-xl transition-all"
          >
            <LogOut className="w-3.5 h-3.5" />
            End Admin Session
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 p-8 overflow-y-auto">
        <header className="flex justify-between items-center mb-8">
          <div>
            <h1 className="text-3xl font-extrabold text-white tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
              {selectedCompanyId === 'all' ? 'Global Operations Control Desk' : `${selectedCompanyName} Operations Control Desk`}
            </h1>
            <p className="text-sm text-gray-400 mt-1">
              {selectedCompanyId === 'all' 
                ? 'System-wide aggregates, multi-tenant matrices, and live resolution timeline diagnostics' 
                : 'Active company configurations, manual dispatch tools, and tenant statistics'}
            </p>
          </div>

          {userProfile?.role === 'SUPER_ADMIN' && (
            <div className="flex items-center gap-3 bg-[#0e121c] border border-white/5 rounded-xl px-4 py-2 shadow-lg">
              <Building className="w-4 h-4 text-gray-400" />
              <label className="text-xs text-gray-400 font-semibold uppercase tracking-wider">Tenant Scope:</label>
              <select
                value={selectedCompanyId || 'all'}
                onChange={e => {
                  const val = e.target.value;
                  setSelectedCompanyId(val);
                  localStorage.setItem('vams_admin_selected_company_id', val);
                  setExpandedCompanyId(null);
                }}
                className="bg-[#171c2a] border border-white/10 rounded px-2.5 py-1 text-xs text-white focus:outline-none cursor-pointer"
              >
                <option value="all">All Companies (Global)</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
          )}
        </header>

        {/* Overview Tab Content */}
        {activeTab === 'overview' && (
          <div className="space-y-8">
            {/* Stat Counters - Single Line Row */}
            <div className="grid grid-cols-5 gap-3 lg:gap-4 w-full">
              {/* Total Defects */}
              <div 
                onClick={() => handleTelemetryCardClick('ALL')}
                className={`glass-panel p-4 lg:p-5 relative overflow-hidden flex flex-col justify-between rounded-2xl border transition-all duration-300 hover:-translate-y-1 shadow-lg group min-h-[140px] cursor-pointer ${
                  telemetryModalOpen && telemetryFilter === 'ALL'
                    ? 'border-blue-500 ring-2 ring-blue-500/50 bg-blue-500/10'
                    : 'border-white/10 hover:border-blue-500/40'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-blue-500/5 rounded-full blur-xl group-hover:bg-blue-500/10 transition-all"></div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10px] xl:text-[11px] font-bold text-gray-400 uppercase tracking-wider truncate" title="Total Defects (Click to inspect all alerts)">Total Defects</span>
                  <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center shrink-0">
                    <Activity className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-blue-400" />
                  </div>
                </div>
                <div className="my-1.5">
                  <h3 className="text-2xl lg:text-3xl xl:text-4xl font-extrabold text-white tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
                    {analytics?.summary?.totalDefects ?? 0}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] xl:text-[10px] text-gray-400 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"></span>
                  <span className="truncate" title="Click to view all alerts">Cumulative lifetime alerts</span>
                </div>
              </div>

              {/* Open Defects */}
              <div 
                onClick={() => handleTelemetryCardClick('OPEN')}
                className={`glass-panel p-4 lg:p-5 relative overflow-hidden flex flex-col justify-between rounded-2xl border border-l-4 border-l-amber-500 transition-all duration-300 hover:-translate-y-1 shadow-lg group min-h-[140px] cursor-pointer ${
                  telemetryModalOpen && telemetryFilter === 'OPEN'
                    ? 'border-amber-500 ring-2 ring-amber-500/50 bg-amber-500/10'
                    : 'border-amber-500/20 hover:border-amber-500/40'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-500/5 rounded-full blur-xl group-hover:bg-amber-500/10 transition-all"></div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10px] xl:text-[11px] font-bold text-amber-400/90 uppercase tracking-wider truncate" title="Open Defects (Click to inspect open alerts)">Open Defects</span>
                  <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center shrink-0">
                    <AlertTriangle className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-amber-400" />
                  </div>
                </div>
                <div className="my-1.5">
                  <h3 className="text-2xl lg:text-3xl xl:text-4xl font-extrabold text-amber-400 tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
                    {analytics?.summary?.openDefects ?? 0}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] xl:text-[10px] text-amber-400/80 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0 animate-pulse"></span>
                  <span className="truncate" title="Click to view open alerts">Awaiting engineering resolve</span>
                </div>
              </div>

              {/* Resolved Defects */}
              <div 
                onClick={() => handleTelemetryCardClick('RESOLVED')}
                className={`glass-panel p-4 lg:p-5 relative overflow-hidden flex flex-col justify-between rounded-2xl border border-l-4 border-l-emerald-500 transition-all duration-300 hover:-translate-y-1 shadow-lg group min-h-[140px] cursor-pointer ${
                  telemetryModalOpen && telemetryFilter === 'RESOLVED'
                    ? 'border-emerald-500 ring-2 ring-emerald-500/50 bg-emerald-500/10'
                    : 'border-emerald-500/20 hover:border-emerald-500/40'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-emerald-500/5 rounded-full blur-xl group-hover:bg-emerald-500/10 transition-all"></div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10px] xl:text-[11px] font-bold text-emerald-400/90 uppercase tracking-wider truncate" title="Resolved Defects (Click to inspect resolved alerts)">Resolved Defects</span>
                  <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center shrink-0">
                    <CheckCircle className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-emerald-400" />
                  </div>
                </div>
                <div className="my-1.5">
                  <h3 className="text-2xl lg:text-3xl xl:text-4xl font-extrabold text-emerald-400 tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
                    {analytics?.summary?.resolvedDefects ?? 0}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] xl:text-[10px] text-emerald-400/80 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0"></span>
                  <span className="truncate" title="Click to view resolved alerts">Successfully closed tasks</span>
                </div>
              </div>

              {/* Reopened Defects */}
              <div 
                onClick={() => handleTelemetryCardClick('REOPENED')}
                className={`glass-panel p-4 lg:p-5 relative overflow-hidden flex flex-col justify-between rounded-2xl border border-l-4 border-l-rose-500 transition-all duration-300 hover:-translate-y-1 shadow-lg group min-h-[140px] cursor-pointer ${
                  telemetryModalOpen && telemetryFilter === 'REOPENED'
                    ? 'border-rose-500 ring-2 ring-rose-500/50 bg-rose-500/10'
                    : 'border-rose-500/20 hover:border-rose-500/40'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/5 rounded-full blur-xl group-hover:bg-rose-500/10 transition-all"></div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10px] xl:text-[11px] font-bold text-rose-400/90 uppercase tracking-wider truncate" title="Reopened Defects (Click to inspect reopened alerts)">Reopened Defects</span>
                  <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center shrink-0">
                    <ShieldAlert className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-rose-400" />
                  </div>
                </div>
                <div className="my-1.5">
                  <h3 className="text-2xl lg:text-3xl xl:text-4xl font-extrabold text-rose-400 tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
                    {analytics?.summary?.reopenedDefects ?? 0}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] xl:text-[10px] text-rose-400/80 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-400 shrink-0"></span>
                  <span className="truncate" title="Click to view reopened alerts">Recurrent faults reported</span>
                </div>
              </div>

              {/* Reassigned Defects */}
              <div 
                onClick={() => handleTelemetryCardClick('REASSIGNED')}
                className={`glass-panel p-4 lg:p-5 relative overflow-hidden flex flex-col justify-between rounded-2xl border border-l-4 border-l-sky-500 transition-all duration-300 hover:-translate-y-1 shadow-lg group min-h-[140px] cursor-pointer ${
                  telemetryModalOpen && telemetryFilter === 'REASSIGNED'
                    ? 'border-sky-500 ring-2 ring-sky-500/50 bg-sky-500/10'
                    : 'border-sky-500/20 hover:border-sky-500/40'
                }`}
              >
                <div className="absolute top-0 right-0 w-24 h-24 bg-sky-500/5 rounded-full blur-xl group-hover:bg-sky-500/10 transition-all"></div>
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10px] xl:text-[11px] font-bold text-sky-400/90 uppercase tracking-wider truncate" title="Reassigned Defects (Click to inspect reassigned alerts)">Reassigned Defects</span>
                  <div className="w-7 h-7 lg:w-8 lg:h-8 rounded-lg lg:rounded-xl bg-sky-500/10 border border-sky-500/20 flex items-center justify-center shrink-0">
                    <Users className="w-3.5 h-3.5 lg:w-4 lg:h-4 text-sky-400" />
                  </div>
                </div>
                <div className="my-1.5">
                  <h3 className="text-2xl lg:text-3xl xl:text-4xl font-extrabold text-sky-400 tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
                    {analytics?.summary?.reassignedDefects ?? 0}
                  </h3>
                </div>
                <div className="flex items-center gap-1.5 text-[9px] xl:text-[10px] text-sky-400/80 font-medium">
                  <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0"></span>
                  <span className="truncate" title="Click to view reassigned alerts">Handovers and re-routings</span>
                </div>
              </div>
            </div>

            {/* Redesigned Multi-Tenant Explorer Grid */}
            {selectedCompanyId === 'all' && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold text-white flex items-center gap-2">
                      <Building className="w-5 h-5 text-blue-500" />
                      Multi-Tenant Workspace Explorer
                    </h2>
                    <p className="text-xs text-gray-400">Track and manage users, license limits, configurations, and tasks for each company from this single pane.</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6">
                  {analytics?.companiesData && analytics.companiesData.length > 0 ? (
                    analytics.companiesData.map(c => {
                      const isExpanded = expandedCompanyId === c.id;
                      const userCount = c.users.length;
                      const openAlerts = c.alerts.filter(a => a.status === 'OPEN' || a.status === 'IN_PROGRESS').length;
                      const maxLicense = c.settings?.maxUsers ?? 0;

                      return (
                        <div key={c.id} className="glass-panel border border-white/5 rounded-2xl overflow-hidden shadow-lg transition-all duration-300">
                          {/* Company summary row */}
                          <div className="p-6 flex flex-wrap items-center justify-between gap-4 bg-white/[0.01] hover:bg-white/[0.02] transition-all">
                            <div className="flex items-center gap-4">
                              <div className="grad-primary p-3 rounded-xl flex items-center justify-center shadow-md">
                                <Building className="w-6 h-6 text-white" />
                              </div>
                              <div>
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">{c.name}</h3>
                                <span className="text-[10px] text-gray-500 font-mono block">Tenant ID: {c.id}</span>
                              </div>
                            </div>

                            <div className="flex flex-wrap gap-4 text-xs font-semibold text-gray-300">
                              <div className="bg-[#121620] px-4 py-2 border border-white/5 rounded-xl">
                                <p className="text-[10px] text-gray-500 uppercase">License</p>
                                <p className="text-sm font-bold text-white">{userCount} / {maxLicense === 0 ? '∞' : maxLicense} Users</p>
                              </div>
                              <div className="bg-[#121620] px-4 py-2 border border-white/5 rounded-xl">
                                <p className="text-[10px] text-gray-500 uppercase">Open Defects</p>
                                <p className="text-sm font-bold text-amber-500">{openAlerts} Active</p>
                              </div>
                              <div className="bg-[#121620] px-4 py-2 border border-white/5 rounded-xl">
                                <p className="text-[10px] text-gray-500 uppercase">System Status</p>
                                <span className={`inline-block mt-0.5 px-2 py-0.5 text-[10px] font-bold rounded ${
                                  c.isActive ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40' : 'bg-red-950/40 text-red-500 border border-red-900/40'
                                }`}>
                                  {c.isActive ? 'ACTIVE' : 'SUSPENDED'}
                                </span>
                              </div>
                            </div>

                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  setSelectedCompanyId(c.id);
                                  localStorage.setItem('vams_admin_selected_company_id', c.id);
                                }}
                                className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold text-xs shadow-md transition-all flex items-center gap-1.5"
                              >
                                <Activity className="w-3.5 h-3.5" />
                                Scope Workspace
                              </button>

                              <button
                                onClick={() => {
                                  if (isExpanded) {
                                    setExpandedCompanyId(null);
                                  } else {
                                    setExpandedCompanyId(c.id);
                                    setCompanySubTab('users');
                                  }
                                }}
                                className="px-3.5 py-2 bg-gray-800 hover:bg-gray-700 text-white border border-white/10 rounded-xl font-semibold text-xs transition-all"
                              >
                                {isExpanded ? 'Collapse Workspace' : 'Inspect Workspace'}
                              </button>
                            </div>
                          </div>

                          {/* Expanded Multi-Tenant Workspace Details */}
                          {isExpanded && (
                            <div className="border-t border-white/5 bg-[#090b10] p-6 space-y-6">
                              {/* Sub-tab navigation */}
                              <div className="flex gap-2 border-b border-white/5 pb-3">
                                <button
                                  onClick={() => setCompanySubTab('users')}
                                  className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                    companySubTab === 'users'
                                      ? 'bg-blue-600 text-white'
                                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                                  }`}
                                >
                                  Users & Employees ({c.users.length})
                                </button>
                                <button
                                  onClick={() => setCompanySubTab('tasks')}
                                  className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                    companySubTab === 'tasks'
                                      ? 'bg-blue-600 text-white'
                                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                                  }`}
                                >
                                  Defect Alert Tasks ({c.alerts.length})
                                </button>
                                <button
                                  onClick={() => setCompanySubTab('policies')}
                                  className={`px-4 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                                    companySubTab === 'policies'
                                      ? 'bg-blue-600 text-white'
                                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                                  }`}
                                >
                                  Licensing & Whitelist Policies
                                </button>
                              </div>

                              {/* Company Users Sub-tab */}
                              {companySubTab === 'users' && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="border-b border-white/5 text-gray-400 text-[10px] uppercase tracking-wider">
                                        <th className="py-3 px-4">Operator Name</th>
                                        <th className="py-3 px-4">Email</th>
                                        <th className="py-3 px-4">System Role</th>
                                        <th className="py-3 px-4 text-center">Currently Open</th>
                                        <th className="py-3 px-4 text-center">Resolved</th>
                                        <th className="py-3 px-4 text-center">Reopened</th>
                                        <th className="py-3 px-4 text-center">Reassigned</th>
                                        <th className="py-3 px-4 text-right">Actions</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 text-xs text-gray-300">
                                      {c.users.length > 0 ? (
                                        c.users.map(u => (
                                          <tr key={u.id} className="hover:bg-white/5 transition-all">
                                            <td className="py-3.5 px-4 font-semibold text-white">{u.name}</td>
                                            <td className="py-3.5 px-4 text-gray-400">{u.email}</td>
                                            <td className="py-3.5 px-4">
                                              <span className="bg-[#171c2a] border border-white/5 px-2 py-0.5 rounded text-[10px] font-semibold text-[#8b5cf6]">
                                                {u.role}
                                              </span>
                                            </td>
                                            <td className="py-3.5 px-4 text-center text-amber-500 font-semibold">{u.currentlyAssigned}</td>
                                            <td className="py-3.5 px-4 text-center text-emerald-500 font-semibold">{u.resolvedCount}</td>
                                            <td className="py-3.5 px-4 text-center text-rose-500 font-semibold">{u.reopenedCount}</td>
                                            <td className="py-3.5 px-4 text-center text-sky-500 font-semibold">{u.reassignedCount}</td>
                                            <td className="py-3.5 px-4 text-right">
                                              <button
                                                onClick={() => toggleUserStatus(u.id, u.isActive)}
                                                className={`px-2.5 py-1 text-[10px] font-bold rounded transition-all ${
                                                  u.isActive
                                                    ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40 hover:bg-emerald-900/30'
                                                    : 'bg-red-950/40 text-red-500 border border-red-900/40 hover:bg-red-900/30'
                                                }`}
                                              >
                                                {u.isActive ? 'Suspend' : 'Activate'}
                                              </button>
                                            </td>
                                          </tr>
                                        ))
                                      ) : (
                                        <tr>
                                          <td colSpan={8} className="py-8 text-center text-gray-500 text-xs">No registered operators/users under this company</td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Company Tasks Sub-tab */}
                              {companySubTab === 'tasks' && (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-left border-collapse">
                                    <thead>
                                      <tr className="border-b border-white/5 text-gray-400 text-[10px] uppercase tracking-wider">
                                        <th className="py-3 px-4">VIN Number</th>
                                        <th className="py-3 px-4">Defect Name</th>
                                        <th className="py-3 px-4 text-center">Severity</th>
                                        <th className="py-3 px-4 text-center">Task Status</th>
                                        <th className="py-3 px-4 font-medium">Assigned operator</th>
                                        <th className="py-3 px-4 text-right">Created Date</th>
                                      </tr>
                                    </thead>
                                    <tbody className="divide-y divide-white/5 text-xs text-gray-300">
                                      {c.alerts.length > 0 ? (
                                        c.alerts.map(a => {
                                          let sevClass = 'bg-gray-800 text-gray-400';
                                          if (a.severity === 'HIGH') sevClass = 'bg-orange-950/40 text-orange-400 border border-orange-900/40';
                                          else if (a.severity === 'CRITICAL' || a.severity === 'EMERGENCY') sevClass = 'bg-red-950/40 text-red-400 border border-red-900/40';
                                          else if (a.severity === 'MEDIUM') sevClass = 'bg-yellow-950/40 text-yellow-500 border border-yellow-900/40';

                                          let statClass = 'bg-gray-800 text-gray-300';
                                          if (a.status === 'OPEN') statClass = 'bg-blue-950/40 text-blue-400 border border-blue-900/40';
                                          else if (a.status === 'IN_PROGRESS') statClass = 'bg-amber-950/40 text-amber-500 border border-amber-900/40';
                                          else if (a.status === 'RESOLVED') statClass = 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40';
                                          else if (a.status === 'REOPENED') statClass = 'bg-rose-950/40 text-rose-500 border border-rose-900/40';

                                          return (
                                            <tr key={a.id} className="hover:bg-white/5 transition-all">
                                              <td className="py-3.5 px-4 font-mono font-bold text-white">{a.vin}</td>
                                              <td className="py-3.5 px-4 font-medium">{a.defectName}</td>
                                              <td className="py-3.5 px-4 text-center">
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${sevClass}`}>
                                                  {a.severity}
                                                </span>
                                              </td>
                                              <td className="py-3.5 px-4 text-center">
                                                <span className={`px-2 py-0.5 rounded text-[9px] font-bold ${statClass}`}>
                                                  {a.status}
                                                </span>
                                              </td>
                                              <td className="py-3.5 px-4 text-gray-300 font-medium">
                                                {a.assignedToUser ? `${a.assignedToUser.name} (${a.assignedToUser.role})` : 'Unassigned / Dynamic'}
                                              </td>
                                              <td className="py-3.5 px-4 text-right text-gray-500 font-medium">{new Date(a.createdAt).toLocaleDateString()}</td>
                                            </tr>
                                          );
                                        })
                                      ) : (
                                        <tr>
                                          <td colSpan={6} className="py-8 text-center text-gray-500 text-xs">No defect/alert tasks recorded under this company</td>
                                        </tr>
                                      )}
                                    </tbody>
                                  </table>
                                </div>
                              )}

                              {/* Company Policies Sub-tab */}
                              {companySubTab === 'policies' && (
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-xs bg-[#111522]/30 border border-white/5 p-5 rounded-2xl">
                                  <div className="space-y-4">
                                    <h4 className="font-bold text-white border-b border-white/5 pb-2 uppercase tracking-wide text-[10px] text-gray-400">Licensing Restrictions</h4>
                                    <div>
                                      <p className="text-gray-400">Max Active User License Cap:</p>
                                      <p className="text-sm font-bold text-white mt-1">{c.settings?.maxUsers === 0 ? 'Unlimited Users' : `${c.settings?.maxUsers} Active Users`}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-400">Emergency Sound Alarm Profile:</p>
                                      <p className="text-sm font-bold text-white mt-1 font-mono">{c.settings?.soundEmergency ?? 'siren.mp3'}</p>
                                    </div>
                                    <div>
                                      <p className="text-gray-400 mt-2">Permitted White-listed Roles:</p>
                                      <div className="flex flex-wrap gap-1.5 mt-2">
                                        {c.settings?.allowedRoles && c.settings.allowedRoles.length > 0 ? (
                                          c.settings.allowedRoles.map(role => (
                                            <span key={role} className="bg-[#121620] border border-white/5 px-2 py-0.5 rounded text-[9px] font-semibold text-gray-300">
                                              {role.replace('_', ' ')}
                                            </span>
                                          ))
                                        ) : (
                                          <span className="text-gray-500 italic">No role whitelist configured (All roles permitted)</span>
                                        )}
                                      </div>
                                    </div>
                                  </div>

                                  <div className="space-y-4">
                                    <h4 className="font-bold text-white border-b border-white/5 pb-2 uppercase tracking-wide text-[10px] text-gray-400">Automated Messaging Integrations</h4>
                                    <div>
                                      <p className="text-gray-400">WhatsApp Alert Reminders:</p>
                                      <span className={`inline-block mt-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                                        c.settings?.whatsappEnabled ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40' : 'bg-gray-800 text-gray-500 border border-transparent'
                                      }`}>
                                        {c.settings?.whatsappEnabled ? 'ENABLED' : 'DISABLED'}
                                      </span>
                                    </div>
                                    {c.settings?.whatsappEnabled && (
                                      <>
                                        <div>
                                          <p className="text-gray-400">Sender API Gateway Key:</p>
                                          <p className="text-xs font-mono font-bold text-gray-300 truncate mt-1">••••••••••••••••</p>
                                        </div>
                                        <div>
                                          <p className="text-gray-400">Registered WhatsApp Sender Num:</p>
                                          <p className="text-sm font-mono font-bold text-white mt-1">{c.settings?.whatsappSenderNum ?? 'None'}</p>
                                        </div>
                                      </>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Workspace Action Hub */}
                              <div className="flex justify-end gap-2 text-xs pt-4 border-t border-white/5">
                                <button
                                  onClick={() => {
                                    setSelectedCompanyId(c.id);
                                    localStorage.setItem('vams_admin_selected_company_id', c.id);
                                    setActiveTab('dispatch');
                                  }}
                                  className="px-3 py-1.5 bg-[#121620] hover:bg-white/5 border border-white/10 rounded-xl font-semibold text-gray-300 transition-all flex items-center gap-1.5"
                                >
                                  <PlusCircle className="w-3.5 h-3.5" />
                                  Dispatch Defect Alert
                                </button>
                                <button
                                  onClick={() => {
                                    setSelectedCompanyId(c.id);
                                    localStorage.setItem('vams_admin_selected_company_id', c.id);
                                    setActiveTab('policy');
                                  }}
                                  className="px-3 py-1.5 bg-[#121620] hover:bg-white/5 border border-white/10 rounded-xl font-semibold text-gray-300 transition-all flex items-center gap-1.5"
                                >
                                  <Settings className="w-3.5 h-3.5" />
                                  Licensing & Policy
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="glass-panel p-8 text-center text-gray-500 rounded-2xl">
                      No company tenants registered. Select a company in the header or matrices.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Scoped Company Layout Overview */}
            {selectedCompanyId !== 'all' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                <div className="glass-panel p-6 rounded-2xl border border-white/5">
                  <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                    <Users className="w-5 h-5 text-purple-500" />
                    Active Tenant Users Directory
                  </h3>
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-white/5 text-gray-400 text-[10px] uppercase">
                          <th className="py-2.5 px-3">Name</th>
                          <th className="py-2.5 px-3">Role</th>
                          <th className="py-2.5 px-3 text-center">Open Tasks</th>
                          <th className="py-2.5 px-3 text-right">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5 text-xs text-gray-300">
                        {analytics?.userPerformance && analytics.userPerformance.length > 0 ? (
                          analytics.userPerformance.map(u => (
                            <tr key={u.id} className="hover:bg-white/5 transition-all">
                              <td className="py-3 px-3 font-semibold text-white">{u.name}</td>
                              <td className="py-3 px-3">
                                <span className="bg-[#171c2a] border border-white/5 px-2 py-0.5 rounded text-[10px] font-semibold text-[#8b5cf6]">
                                  {u.role}
                                </span>
                              </td>
                              <td className="py-3 px-3 text-center text-amber-500 font-semibold">{u.currentlyAssigned}</td>
                              <td className="py-3 px-3 text-right">
                                <span className={`inline-block px-2 py-0.5 text-[9px] font-bold rounded ${
                                  u.isActive ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40' : 'bg-red-950/40 text-red-500 border border-red-900/40'
                                }`}>
                                  {u.isActive ? 'Active' : 'Suspended'}
                                </span>
                              </td>
                            </tr>
                          ))
                        ) : (
                          <tr>
                            <td colSpan={4} className="py-6 text-center text-gray-500">No active operators in scope</td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="glass-panel p-6 rounded-2xl border border-white/5">
                  <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                    <AlertTriangle className="w-5 h-5 text-amber-500" />
                    Open Defect Tickets
                  </h3>
                  <div className="space-y-4 max-h-[420px] overflow-y-auto pr-2 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent">
                    {analytics?.companiesData && analytics.companiesData[0]?.alerts?.filter(a => a.status !== 'RESOLVED').length ? (
                      analytics.companiesData[0].alerts.filter(a => a.status !== 'RESOLVED').map(a => {
                        let borderClass = 'border-l-gray-500';
                        let sevClass = 'bg-gray-800/60 text-gray-400 border border-gray-700/40';
                        if (a.severity === 'HIGH') {
                          borderClass = 'border-l-orange-500';
                          sevClass = 'bg-orange-500/10 text-orange-400 border border-orange-500/20';
                        } else if (a.severity === 'CRITICAL' || a.severity === 'EMERGENCY') {
                          borderClass = 'border-l-red-500';
                          sevClass = 'bg-red-500/10 text-red-400 border border-red-500/20';
                        } else if (a.severity === 'MEDIUM') {
                          borderClass = 'border-l-amber-500';
                          sevClass = 'bg-amber-500/10 text-amber-400 border border-amber-500/20';
                        } else if (a.severity === 'LOW') {
                          borderClass = 'border-l-blue-500';
                          sevClass = 'bg-blue-500/10 text-blue-400 border border-blue-500/20';
                        }

                        let displayStatus = a.status;
                        let statClass = 'text-blue-400 bg-blue-500/10 border border-blue-500/20';
                        if (a.status === 'RESOLVED') {
                          displayStatus = 'RESOLVED';
                          statClass = 'text-emerald-400 bg-emerald-500/10 border border-emerald-500/20';
                        } else if (a.escalationStep > 0) {
                          displayStatus = 'ESCALATED';
                          statClass = 'text-red-400 bg-red-500/10 border border-red-500/20';
                        } else if (a.status === 'IN_PROGRESS' || a.assignedToUserId) {
                          displayStatus = 'IN PROGRESS';
                          statClass = 'text-amber-400 bg-amber-500/10 border border-amber-500/20';
                        } else {
                          displayStatus = 'PENDING';
                          statClass = 'text-blue-400 bg-blue-500/10 border border-blue-500/20';
                        }

                        const isBreached = a.status !== 'RESOLVED' && (a.escalationStep > 0 || (a.nextEscalationAt && new Date(a.nextEscalationAt) < new Date()));

                        return (
                          <div 
                            key={a.id} 
                            className={`p-4 bg-[#111522]/30 border border-white/5 border-l-4 ${borderClass} rounded-xl flex items-center justify-between gap-4 hover:bg-[#111522]/60 hover:border-white/10 hover:translate-x-1 transition-all duration-300`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="px-2 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-gray-400 font-mono tracking-wider font-semibold">
                                  VIN: {a.vin}
                                </span>
                                <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold tracking-wide uppercase ${sevClass}`}>
                                  {a.severity}
                                </span>
                              </div>
                              
                              <p className="text-white font-bold text-sm mt-2 truncate tracking-wide">
                                {a.defectName || 'Unspecified Defect'}
                              </p>
                              
                              <div className="flex items-center gap-4 mt-2.5 flex-wrap">
                                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                  <User className="w-3.5 h-3.5 text-gray-500" />
                                  <span>
                                    Assigned: <strong className="text-gray-300 font-semibold">{a.assignedToUser ? a.assignedToUser.name : 'Dynamic'}</strong>
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
                                  <Clock className="w-3.5 h-3.5 text-gray-500" />
                                  <span>
                                    {new Date(a.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                  </span>
                                </div>
                              </div>
                            </div>
                            
                            <div className="flex flex-col items-end justify-center gap-2 shrink-0">
                              <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold tracking-wide uppercase shadow-sm ${statClass}`}>
                                {displayStatus}
                              </span>
                              {isBreached && (
                                <span className="bg-red-500/10 text-red-400 border border-red-500/20 text-[8px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider animate-pulse shadow-sm">
                                  SLA Breach
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="text-center text-gray-500 py-10">No active unresolved defects</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* Severity Distribution & Timeline Audit logs */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <div className="glass-panel p-6 rounded-2xl border border-white/5">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <AlertTriangle className="w-5 h-5 text-[#3b82f6]" />
                  Defects by Severity (Open Tasks)
                </h3>
                {analytics?.severityDistribution && Object.keys(analytics.severityDistribution).length > 0 ? (
                  <div className="space-y-4">
                    {Object.entries(analytics.severityDistribution).map(([sev, count]) => {
                      const maxVal = Math.max(...Object.values(analytics.severityDistribution), 1);
                      const pct = (count / maxVal) * 100;
                      return (
                        <div key={sev} className="space-y-1.5">
                          <div className="flex justify-between text-xs font-semibold">
                            <span className="text-gray-400">{sev}</span>
                            <span className="text-white">{count} Open</span>
                          </div>
                          <div className="w-full bg-[#111522] h-2.5 rounded-full overflow-hidden">
                            <div 
                              className="h-full bg-gradient-to-r from-blue-600 to-indigo-600 transition-all duration-500" 
                              style={{ width: `${pct}%` }}
                            ></div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-40 items-center justify-center text-xs text-gray-500">
                    No active telemetry metrics available
                  </div>
                )}
              </div>

              <div className="glass-panel p-6 rounded-2xl border border-white/5">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <Activity className="w-5 h-5 text-[#8b5cf6]" />
                  Live Defect Transaction Audit Timeline
                </h3>
                <div className="overflow-y-auto max-h-[220px] space-y-3 pr-1">
                  {analytics?.auditTimeline && analytics.auditTimeline.length > 0 ? (
                    analytics.auditTimeline.map(evt => (
                      <div key={evt.id} className="text-xs flex justify-between p-2.5 bg-[#111522]/50 border border-white/5 rounded-xl hover:bg-[#111522]/80 transition-all">
                        <div className="space-y-1 pr-4">
                          <span className="font-semibold text-white block">{evt.actionType}</span>
                          <span className="text-gray-400 block">{evt.details}</span>
                        </div>
                        <span className="text-[10px] text-gray-500 shrink-0 font-medium">{new Date(evt.createdAt).toLocaleTimeString()}</span>
                      </div>
                    ))
                  ) : (
                    <div className="text-center text-gray-500 text-xs py-10">No events logged</div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Manual Dispatch Tab Content */}
        {activeTab === 'dispatch' && (
          <div className="max-w-2xl">
            {selectedCompanyId === 'all' ? (
              <div className="glass-panel p-8 text-center text-gray-400 rounded-2xl border border-white/5">
                <AlertTriangle className="w-8 h-8 text-yellow-500 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-2">Manual Dispatch Scoping Required</h3>
                <p className="text-xs max-w-md mx-auto">
                  Please select a specific company tenant from the <strong>Tenant Scope</strong> selector in the top-right header to assign and dispatch repair tickets.
                </p>
              </div>
            ) : (
              <div className="glass-panel p-8 relative overflow-hidden rounded-2xl border border-white/5">
                <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-title)' }}>
                  Manual Defect Dispatcher console
                </h2>
                <p className="text-xs text-gray-400 mb-6">
                  Directly route a manual defect ticket to a specific operator on the factory floor
                </p>

                <form onSubmit={handleManualDispatch} className="space-y-5">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Alert Type
                    </label>
                    <select
                      required
                      value={manualAlertDefinitionId}
                      onChange={e => {
                        const val = e.target.value;
                        setManualAlertDefinitionId(val);
                        if (val) {
                          const selectedDef = definitions.find(d => d.id === val);
                          if (selectedDef) {
                            setManualSeverity(selectedDef.severity);
                            if (selectedDef.primaryAssigneeId) {
                              setManualAssigneeId(`user_${selectedDef.primaryAssigneeId}`);
                            } else {
                              setManualAssigneeId('');
                            }
                          }
                        } else {
                          setManualSeverity('MEDIUM');
                          setManualAssigneeId('');
                        }
                      }}
                      className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all cursor-pointer"
                    >
                      <option value="">Select alert type definition...</option>
                      {definitions.map(def => (
                        <option key={def.id} value={def.id}>{def.name} ({def.severity} - {def.type})</option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Severity Level
                    </label>
                    <select
                      required
                      value={manualSeverity}
                      onChange={e => setManualSeverity(e.target.value)}
                      className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all cursor-pointer"
                    >
                      <option value="INFO">Info (INFO)</option>
                      <option value="LOW">Low (LOW)</option>
                      <option value="MEDIUM">Medium (MEDIUM)</option>
                      <option value="HIGH">High (HIGH)</option>
                      <option value="CRITICAL">Critical (CRITICAL)</option>
                      <option value="EMERGENCY">Emergency (EMERGENCY)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Floor Assignee (Role / Employee)
                    </label>
                    <select
                      value={manualAssigneeId}
                      onChange={e => setManualAssigneeId(e.target.value)}
                      className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all cursor-pointer"
                    >
                      <option value="">Use template assignee from Alert Definition...</option>
                      
                      <optgroup label="System Roles" className="text-gray-400 font-semibold bg-[#171c2a]">
                        <option value="role_QUALITY_INSPECTOR" className="text-white">Quality Inspector (QUALITY_INSPECTOR)</option>
                        <option value="role_WORKER" className="text-white">Worker / Operator (WORKER)</option>
                        <option value="role_SUPERVISOR" className="text-white">Supervisor (SUPERVISOR)</option>
                        <option value="role_SERVICE_ENGINEER" className="text-white">Service Engineer (SERVICE_ENGINEER)</option>
                        <option value="role_FACTORY_MANAGER" className="text-white">Factory Manager (FACTORY_MANAGER)</option>
                      </optgroup>

                      <optgroup label="Specific Employees" className="text-gray-400 font-semibold bg-[#171c2a]">
                        {analytics?.userPerformance?.filter(u => !selectedCompanyId || selectedCompanyId === 'all' || u.companyId === selectedCompanyId || userProfile?.role !== 'SUPER_ADMIN').map(u => (
                          <option key={u.id} value={`user_${u.id}`} className="text-white">
                            {u.name} ({u.role}) {selectedCompanyId === 'all' ? ` - ${u.companyName || 'Unknown'}` : ''}
                          </option>
                        ))}
                      </optgroup>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Dispatcher Notes & Instructions
                    </label>
                    <textarea
                      rows={3}
                      value={manualNotes}
                      onChange={e => setManualNotes(e.target.value)}
                      placeholder="Enter special repair instructions or inspector feedback..."
                      className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all resize-none"
                    ></textarea>
                  </div>

                  {dispatchSuccess && (
                    <div className="flex items-center gap-2 p-3 bg-emerald-950/40 border border-emerald-900/50 rounded-xl text-xs text-emerald-400">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>{dispatchSuccess}</span>
                    </div>
                  )}

                  {dispatchError && (
                    <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-900/50 rounded-xl text-xs text-red-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{dispatchError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full btn-premium grad-primary py-3 rounded-xl font-semibold hover:opacity-90 flex items-center justify-center gap-2 text-white shadow-lg"
                  >
                    <PlusCircle className="w-5 h-5" /> Dispatch Alert Ticket
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {activeTab === 'alerts' && (
          <div className="space-y-8">
            {selectedCompanyId === 'all' ? (
              <div className="glass-panel p-8 text-center text-gray-400 rounded-2xl border border-white/5">
                <AlertTriangle className="w-8 h-8 text-yellow-500 mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-2">Alert Management Scoping Required</h3>
                <p className="text-xs max-w-md mx-auto">
                  Please select a specific company tenant from the <strong>Tenant Scope</strong> selector in the top-right header to define and manage alert templates.
                </p>
              </div>
            ) : (
              <>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Alert Definition Console Form */}
              <div className="lg:col-span-2 glass-panel p-8 rounded-2xl border border-white/5 shadow-xl relative overflow-hidden">
                <div className="absolute top-0 left-0 w-full h-[3px] grad-primary"></div>
                <div className="mb-6">
                  <h3 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-title)' }}>
                    {editingDef ? 'Edit Alert Definition' : 'Define Custom Alert Template'}
                  </h3>
                  <p className="text-xs text-gray-400">
                    Predefine company-wide alerts with multi-operator SLA escalation chains
                  </p>
                </div>

                <form onSubmit={handleCreateOrUpdateDefinition} className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Alert ID</label>
                      <input
                        type="text"
                        required
                        value={defAlertId}
                        onChange={e => setDefAlertId(e.target.value)}
                        placeholder="e.g. FACTORY_FIRE"
                        className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Alert Name</label>
                      <input
                        type="text"
                        required
                        value={defName}
                        onChange={e => setDefName(e.target.value)}
                        placeholder="e.g. Factory Fire Alert"
                        list="defect-masters-list"
                        className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all"
                      />
                      <datalist id="defect-masters-list">
                        {defectMasters.map(dm => (
                          <option key={dm.id} value={dm.name} />
                        ))}
                      </datalist>
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Category / Alert Type</label>
                      <select
                        required
                        value={defType}
                        onChange={e => setDefType(e.target.value)}
                        className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all cursor-pointer"
                      >
                        <option value="Safety">Safety</option>
                        <option value="Fire">Fire</option>
                        <option value="Equipment">Equipment</option>
                        <option value="Security">Security</option>
                        <option value="Custom">Custom</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Definition / Description</label>
                    <textarea
                      rows={2}
                      value={defDesc}
                      onChange={e => setDefDesc(e.target.value)}
                      placeholder="Explain what this alert means and standard procedure guidelines..."
                      className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all resize-none"
                    ></textarea>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Severity</label>
                      <select
                        required
                        value={defSeverity}
                        onChange={e => setDefSeverity(e.target.value)}
                        className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all cursor-pointer"
                      >
                        <option value="INFO">Info (INFO)</option>
                        <option value="LOW">Low (LOW)</option>
                        <option value="MEDIUM">Medium (MEDIUM)</option>
                        <option value="HIGH">High (HIGH)</option>
                        <option value="CRITICAL">Critical (CRITICAL)</option>
                        <option value="EMERGENCY">Emergency (EMERGENCY)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Escalation Timeout (mins)</label>
                      <input
                        type="number"
                        required
                        min={1}
                        value={defEscalationTimeout}
                        onChange={e => setDefEscalationTimeout(Number(e.target.value))}
                        className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Primary Assignee (Role / Employee)</label>
                      <select
                        required
                        value={defPrimaryAssignee}
                        onChange={e => setDefPrimaryAssignee(e.target.value)}
                        className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all cursor-pointer"
                      >
                        <option value="">Select Role or Employee...</option>
                        <optgroup label="System Roles (Notifies All Users with Role)" className="text-gray-400 font-semibold bg-[#171c2a]">
                          {SYSTEM_ROLES.map(r => (
                            <option key={r.id} value={r.id} className="text-white font-semibold">
                              {r.label}
                            </option>
                          ))}
                        </optgroup>
                        <optgroup label="Specific Individual Employees" className="text-gray-400 font-semibold bg-[#171c2a]">
                          {analytics?.userPerformance?.filter(u => !selectedCompanyId || selectedCompanyId === 'all' || u.companyId === selectedCompanyId || userProfile?.role !== 'SUPER_ADMIN').map(u => (
                            <option key={u.id} value={u.id} className="text-white">
                              {u.name} ({u.role})
                            </option>
                          ))}
                        </optgroup>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Escalation Chain (Ordered Role / User Notification List)
                    </label>
                    <p className="text-[10px] text-gray-400 mb-2">Click roles or employees below to add/remove them from the SLA escalation queue order</p>
                    <div className="flex flex-wrap gap-2 p-3 bg-[#121620] border border-white/10 rounded-xl min-h-[50px]">
                      {defEscalationChain.length === 0 ? (
                        <span className="text-xs text-gray-500 italic">No role or operator steps in escalation chain</span>
                      ) : (
                        defEscalationChain.map((item, index) => {
                          const systemRoleMatch = SYSTEM_ROLES.find(r => r.id === item || r.role === item || `role_${r.role}` === item);
                          const userObj = analytics?.userPerformance?.find(u => u.id === item);
                          const isRoleItem = !!systemRoleMatch || item.startsWith('role_');
                          const displayName = systemRoleMatch 
                            ? `All ${systemRoleMatch.role.replace('_', ' ')}s` 
                            : (userObj ? userObj.name : item);

                          return (
                            <div key={item} className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border ${
                              isRoleItem 
                                ? 'bg-purple-950/50 border-purple-500/40 text-purple-300 font-semibold' 
                                : 'bg-[#3b82f6]/20 border-[#3b82f6]/30 text-white font-medium'
                            }`}>
                              <span className="font-bold">{index + 1}.</span>
                              <span>{isRoleItem ? `[ROLE] ${displayName}` : displayName}</span>
                              <button
                                type="button"
                                onClick={() => setDefEscalationChain(defEscalationChain.filter(id => id !== item))}
                                className="text-gray-400 hover:text-white font-bold ml-1"
                              >
                                &times;
                              </button>
                            </div>
                          );
                        })
                      )}
                    </div>
                    
                    {/* Add Roles to Escalation Chain */}
                    <div className="mt-2 space-y-1">
                      <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider block">Add System Role:</span>
                      <div className="flex flex-wrap gap-1.5">
                        {SYSTEM_ROLES.map(r => {
                          const isInChain = defEscalationChain.includes(r.id) || defEscalationChain.includes(r.role);
                          if (isInChain || defPrimaryAssignee === r.id || defPrimaryAssignee === r.role) return null;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              onClick={() => setDefEscalationChain([...defEscalationChain, r.id])}
                              className="bg-purple-950/40 hover:bg-purple-900/60 text-purple-300 border border-purple-800/40 text-[10px] px-2.5 py-1 rounded-lg transition-all font-semibold"
                            >
                              + [ROLE] {r.role.replace('_', ' ')}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Add Employees to Escalation Chain */}
                    <div className="mt-2 space-y-1">
                      <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider block">Add Specific Employee:</span>
                      <div className="flex flex-wrap gap-1.5 max-h-[100px] overflow-y-auto p-1">
                        {analytics?.userPerformance?.filter(u => !selectedCompanyId || selectedCompanyId === 'all' || u.companyId === selectedCompanyId || userProfile?.role !== 'SUPER_ADMIN').map(u => {
                          const isInChain = defEscalationChain.includes(u.id);
                          if (isInChain || u.id === defPrimaryAssignee) return null;
                          return (
                            <button
                              key={u.id}
                              type="button"
                              onClick={() => setDefEscalationChain([...defEscalationChain, u.id])}
                              className="bg-white/5 hover:bg-white/10 text-[10px] px-2 py-1 rounded border border-white/5 transition-all text-gray-300"
                            >
                              + {u.name} ({u.role})
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>

                  {alertSuccess && (
                    <div className="flex items-center gap-2 p-3 bg-emerald-950/40 border border-emerald-900/50 rounded-xl text-xs text-emerald-400">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>{alertSuccess}</span>
                    </div>
                  )}

                  {alertError && (
                    <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-900/50 rounded-xl text-xs text-red-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{alertError}</span>
                    </div>
                  )}

                  <div className="flex gap-3">
                    {editingDef && (
                      <button
                        type="button"
                        onClick={() => {
                          setEditingDef(null);
                          setDefName('');
                          setDefDesc('');
                          setDefType('Safety');
                          setDefSeverity('MEDIUM');
                          setDefPrimaryAssignee('');
                          setDefEscalationChain([]);
                          setDefEscalationTimeout(30);
                          setDefCriticalOverride(false);
                        }}
                        className="w-1/3 bg-white/5 hover:bg-white/10 text-white py-3 rounded-xl font-semibold transition-all border border-white/10"
                      >
                        Cancel
                      </button>
                    )}
                    <button
                      type="submit"
                      disabled={isSavingAlert}
                      className="flex-1 btn-premium grad-primary py-3 rounded-xl font-semibold hover:opacity-90 flex items-center justify-center gap-2 text-white shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <PlusCircle className="w-5 h-5" /> {isSavingAlert ? 'Saving...' : (editingDef ? 'Update Definition' : 'Save Definition template')}
                    </button>
                  </div>
                </form>
              </div>

              {/* Company Broadcast Notification Form */}
              <div className="glass-panel p-8 rounded-2xl border border-white/5 shadow-xl relative overflow-hidden flex flex-col justify-between">
                <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-red-500 to-amber-500"></div>
                <div>
                  <div className="mb-6">
                    <h3 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-title)' }}>
                      Company Broadcast
                    </h3>
                    <p className="text-xs text-gray-400">
                      Broadcast custom in-app/push alerts instantly to all company operators
                    </p>
                  </div>

                  <form onSubmit={handleSendBroadcast} className="space-y-4">
                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Message Title</label>
                      <input
                        type="text"
                        required
                        value={broadcastTitle}
                        onChange={e => setBroadcastTitle(e.target.value)}
                        placeholder="e.g. General Announcement"
                        className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Notification Message</label>
                      <textarea
                        rows={5}
                        required
                        value={broadcastMessage}
                        onChange={e => setBroadcastMessage(e.target.value)}
                        placeholder="Type urgent message here..."
                        className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all resize-none"
                      ></textarea>
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-purple-400 uppercase tracking-wider mb-2">
                        Target System Roles (Notifies all active users of selected role)
                      </label>
                      <div className="bg-[#121620] border border-purple-500/20 rounded-xl p-3 max-h-[140px] overflow-y-auto space-y-2 mb-3">
                        {SYSTEM_ROLES.map(r => (
                          <label key={r.id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white">
                            <input
                              type="checkbox"
                              checked={broadcastTargetRoles.includes(r.role)}
                              onChange={() => {
                                if (broadcastTargetRoles.includes(r.role)) {
                                  setBroadcastTargetRoles(broadcastTargetRoles.filter(role => role !== r.role));
                                } else {
                                  setBroadcastTargetRoles([...broadcastTargetRoles, r.role]);
                                }
                              }}
                              className="w-4 h-4 rounded border-white/10 text-purple-500 focus:ring-purple-500 cursor-pointer"
                            />
                            <span className="font-semibold text-purple-300">[ROLE] {r.label}</span>
                          </label>
                        ))}
                      </div>

                      <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                        Target Specific Users (Optional)
                      </label>
                      <div className="bg-[#121620] border border-white/10 rounded-xl p-3 max-h-[130px] overflow-y-auto space-y-2">
                        {analytics?.userPerformance?.filter(u => !selectedCompanyId || selectedCompanyId === 'all' || u.companyId === selectedCompanyId || userProfile?.role !== 'SUPER_ADMIN').map(u => (
                          <label key={u.id} className="flex items-center gap-2 text-xs text-gray-300 cursor-pointer hover:text-white">
                            <input
                              type="checkbox"
                              checked={broadcastTargetUserIds.includes(u.id)}
                              onChange={() => {
                                if (broadcastTargetUserIds.includes(u.id)) {
                                  setBroadcastTargetUserIds(broadcastTargetUserIds.filter(id => id !== u.id));
                                } else {
                                  setBroadcastTargetUserIds([...broadcastTargetUserIds, u.id]);
                                }
                              }}
                              className="w-4 h-4 rounded border-white/10 text-[#3b82f6] focus:ring-[#3b82f6] cursor-pointer"
                            />
                            <span>{u.name} ({u.role})</span>
                          </label>
                        ))}
                        {(!analytics?.userPerformance || analytics.userPerformance.filter(u => !selectedCompanyId || selectedCompanyId === 'all' || u.companyId === selectedCompanyId || userProfile?.role !== 'SUPER_ADMIN').length === 0) && (
                          <span className="text-xs text-gray-500 italic">No company users found</span>
                        )}
                      </div>
                    </div>

                    {broadcastSuccess && (
                      <div className="flex items-center gap-2 p-3 bg-emerald-950/40 border border-emerald-900/50 rounded-xl text-xs text-emerald-400">
                        <CheckCircle className="w-4 h-4 shrink-0" />
                        <span>{broadcastSuccess}</span>
                      </div>
                    )}

                    {broadcastError && (
                      <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-900/50 rounded-xl text-xs text-red-400">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{broadcastError}</span>
                      </div>
                    )}

                    <button
                      type="submit"
                      disabled={isSendingBroadcast}
                      className="w-full bg-gradient-to-r from-red-600 to-amber-600 py-3 rounded-xl font-semibold hover:opacity-90 flex items-center justify-center gap-2 text-white shadow-lg disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Bell className="w-5 h-5" /> {isSendingBroadcast ? 'Sending...' : 'Send Broadcast Alert'}
                    </button>
                  </form>
                </div>
              </div>
            </div>

            {/* Active alert definitions table */}
            <div className="glass-panel p-6 rounded-2xl border border-white/5">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
                <div>
                  <h3 className="text-lg font-bold text-white mb-1" style={{ fontFamily: 'var(--font-title)' }}>
                    Active Alert Definitions
                  </h3>
                  <p className="text-xs text-gray-400">
                    Review and edit alert escalation rules for active company workflows
                  </p>
                </div>

                <div className="flex gap-3">
                  <input
                    type="text"
                    value={alertSearch}
                    onChange={e => setAlertSearch(e.target.value)}
                    placeholder="Search by Name/Type..."
                    className="bg-[#121620] border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-[#3b82f6]"
                  />
                  <select
                    value={alertSeverityFilter}
                    onChange={e => setAlertSeverityFilter(e.target.value)}
                    className="bg-[#121620] border border-white/10 rounded-xl px-4 py-2 text-xs text-white focus:outline-none focus:border-[#3b82f6] cursor-pointer"
                  >
                    <option value="ALL">All Severities</option>
                    <option value="LOW">Low</option>
                    <option value="MEDIUM">Medium</option>
                    <option value="HIGH">High</option>
                    <option value="CRITICAL">Critical</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="py-4 px-4">Alert ID</th>
                      <th className="py-4 px-4">Template Name</th>
                      <th className="py-4 px-4">Alert Type</th>
                      <th className="py-4 px-4">Severity</th>
                      <th className="py-4 px-4">Primary Assignee</th>
                      <th className="py-4 px-4">Escalation Timeout</th>
                      <th className="py-4 px-4">Escalation Chain</th>
                      <th className="py-4 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-gray-300">
                    {definitions
                      .filter(def => {
                        const matchesSearch = def.name.toLowerCase().includes(alertSearch.toLowerCase()) || def.type.toLowerCase().includes(alertSearch.toLowerCase());
                        const matchesSeverity = alertSeverityFilter === 'ALL' || def.severity === alertSeverityFilter;
                        return matchesSearch && matchesSeverity;
                      })
                      .map(def => {
                        const systemRoleMatch = SYSTEM_ROLES.find(r => r.id === def.primaryAssigneeId || r.role === def.primaryAssigneeId || `role_${r.role}` === def.primaryAssigneeId);
                        const assigneeUser = analytics?.userPerformance?.find(u => u.id === def.primaryAssigneeId);
                        const assigneeDisplay = systemRoleMatch
                          ? `[ROLE] ${systemRoleMatch.role.replace('_', ' ')}`
                          : (assigneeUser ? assigneeUser.name : (def.primaryAssigneeId || 'Unknown'));
                        return (
                          <tr key={def.id} className="hover:bg-white/5 transition-all">
                            <td className="py-4 px-4 font-semibold text-gray-400">{def.alertId || 'N/A'}</td>
                            <td className="py-4 px-4 font-semibold text-white">{def.name}</td>
                            <td className="py-4 px-4">{def.type}</td>
                            <td className="py-4 px-4">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                def.severity === 'CRITICAL' || def.severity === 'EMERGENCY'
                                  ? 'bg-red-950/40 text-red-400 border border-red-900/40'
                                  : def.severity === 'HIGH'
                                  ? 'bg-orange-950/40 text-orange-400 border border-orange-900/40'
                                  : 'bg-gray-850 text-gray-400'
                              }`}>{def.severity}</span>
                            </td>
                            <td className="py-4 px-4">{assigneeDisplay}</td>
                            <td className="py-4 px-4">{def.escalationTimeout} mins</td>
                            <td className="py-4 px-4">
                              {def.escalationChain && def.escalationChain.length > 0 ? (
                                <span className="text-gray-400">{def.escalationChain.length} steps chain</span>
                              ) : (
                                <span className="text-gray-500 italic">None defined</span>
                              )}
                            </td>
                            <td className="py-4 px-4 text-right">
                              <div className="flex justify-end gap-3">
                                <button
                                  onClick={() => {
                                    setEditingDef(def);
                                    setDefAlertId(def.alertId || '');
                                    setDefName(def.name);
                                    setDefDesc(def.definition || '');
                                    setDefType(def.type);
                                    setDefSeverity(def.severity);
                                    setDefPrimaryAssignee(def.primaryAssigneeId);
                                    setDefEscalationChain(def.escalationChain || []);
                                    setDefEscalationTimeout(def.escalationTimeout);
                                    setDefCriticalOverride(def.criticalOverride);
                                  }}
                                  className="text-blue-400 hover:text-blue-300 font-semibold"
                                >
                                  Edit
                                </button>
                                <button
                                  onClick={() => handleDeleteDefinition(def.id)}
                                  className="text-red-400 hover:text-red-300 font-semibold"
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    {definitions.length === 0 && (
                      <tr>
                        <td colSpan={8} className="py-8 text-center text-gray-500 italic">No alert definitions defined. Define one above.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Broadcast history audit log table */}
            <div className="glass-panel p-6 rounded-2xl border border-white/5">
              <h3 className="text-lg font-bold text-white mb-2" style={{ fontFamily: 'var(--font-title)' }}>
                Company Broadcast Audit Logs
              </h3>
              <p className="text-xs text-gray-400 mb-6">
                Audit history of one-off company-wide messages dispatched to operators
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="py-4 px-4">Timestamp</th>
                      <th className="py-4 px-4">Broadcast Title</th>
                      <th className="py-4 px-4">Message Content</th>
                      <th className="py-4 px-4">Dispatched By</th>
                      <th className="py-4 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-gray-300">
                    {broadcasts.map(br => {
                      const sender = analytics?.userPerformance?.find(u => u.id === br.sentById);
                      return (
                        <tr key={br.id} className="hover:bg-white/5 transition-all">
                          <td className="py-4 px-4 font-mono text-gray-400">{new Date(br.createdAt).toLocaleString()}</td>
                          <td className="py-4 px-4 font-bold text-white">{br.title}</td>
                          <td className="py-4 px-4 max-w-sm truncate">{br.message}</td>
                          <td className="py-4 px-4">{sender ? sender.name : 'Administrator'}</td>
                          <td className="py-4 px-4 text-right">
                            <button
                              onClick={() => handleDeleteBroadcast(br.id)}
                              className="text-red-400 hover:text-red-300 font-semibold"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {broadcasts.length === 0 && (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-gray-500 italic">No broadcasts sent yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    )}

        {/* Users Tab Content */}
        {activeTab === 'users' && (
          <div className="space-y-6">
            <div className="glass-panel p-6 rounded-2xl border border-white/5">
              <h3 className="text-lg font-bold text-white mb-2" style={{ fontFamily: 'var(--font-title)' }}>
                User Performance Analytics Grid {selectedCompanyId === 'all' && '(All Companies)'}
              </h3>
              <p className="text-xs text-gray-400 mb-6">
                Active telemetry tracks total open reassignments and resolved defect tickets to analyze personnel performance
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-white/5 text-gray-400 text-xs uppercase tracking-wider">
                      <th className="py-4 px-4">Operator Name</th>
                      <th className="py-4 px-4">Company Name</th>
                      <th className="py-4 px-4">System Role</th>
                      <th className="py-4 px-4 text-center">Currently Open</th>
                      <th className="py-4 px-4 text-center">Closed Defects</th>
                      <th className="py-4 px-4 text-center">Reopened Cases</th>
                      <th className="py-4 px-4 text-center">Reassignments</th>
                      <th className="py-4 px-4 text-right">Account Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5 text-xs text-gray-300">
                    {analytics?.userPerformance && analytics.userPerformance.length > 0 ? (
                      analytics.userPerformance.map(u => (
                        <tr key={u.id} className="hover:bg-white/5 transition-all">
                          <td className="py-4 px-4 font-semibold text-white">{u.name}</td>
                          <td className="py-4 px-4 text-gray-400 font-medium">{u.companyName ?? 'HQ Global'}</td>
                          <td className="py-4 px-4">
                            <span className="bg-[#171c2a] border border-white/5 px-2.5 py-1 rounded-md text-[10px] font-semibold text-[#8b5cf6]">
                              {u.role}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-center text-amber-500 font-semibold">{u.currentlyAssigned}</td>
                          <td className="py-4 px-4 text-center text-emerald-500 font-semibold">{u.resolvedCount}</td>
                          <td className="py-4 px-4 text-center text-rose-500 font-semibold">{u.reopenedCount}</td>
                          <td className="py-4 px-4 text-center text-sky-500 font-semibold">{u.reassignedCount}</td>
                          <td className="py-4 px-4 text-right">
                            <button
                              onClick={() => toggleUserStatus(u.id, u.isActive)}
                              className={`inline-block px-3 py-1 rounded-lg font-bold text-[10px] transition-all ${
                                u.isActive
                                  ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40 hover:bg-emerald-900/30'
                                  : 'bg-red-950/40 text-red-500 border border-red-900/40 hover:bg-red-900/30'
                              }`}
                            >
                              {u.isActive ? 'Activated' : 'Suspended'}
                            </button>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={8} className="py-10 text-center text-gray-500">No active operators in selected scope</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Policy Tab Content */}
        {activeTab === 'policy' && (
          <div className="max-w-2xl">
            {selectedCompanyId === 'all' ? (
              <div className="glass-panel p-8 text-center text-gray-400 rounded-2xl border border-white/5">
                <Settings className="w-8 h-8 text-[#8b5cf6] mx-auto mb-4" />
                <h3 className="text-lg font-bold text-white mb-2">Licensing Scoping Required</h3>
                <p className="text-xs max-w-md mx-auto">
                  Please select a specific company tenant from the <strong>Tenant Scope</strong> selector in the top-right header to view and edit user licensing limits, roles, and WhatsApp configuration.
                </p>
              </div>
            ) : (
              <div className="glass-panel p-8 rounded-2xl border border-white/5">
                <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-title)' }}>
                  Licensing, Role Lockdown, & Integrations
                </h2>
                <p className="text-xs text-gray-400 mb-6">
                  Configure tenant limitations, whitelist operational user roles, and activate automated warning services
                </p>

                <form onSubmit={handleUpdatePolicy} className="space-y-6">
                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">1. Max Active User License Limit</h3>
                    <div className="flex items-center gap-3">
                      <input
                        type="number"
                        min="0"
                        value={policyMaxUsers}
                        onChange={e => setPolicyMaxUsers(parseInt(e.target.value, 10))}
                        className="bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] w-32"
                      />
                      <span className="text-xs text-gray-400">
                        Maximum active users allowed. (Set to <code>0</code> for unlimited users).
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">2. Permitted Whitelist System Roles</h3>
                    <div className="grid grid-cols-2 gap-3 bg-[#111522] p-4 rounded-xl border border-white/5">
                      {['FACTORY_MANAGER', 'SUPERVISOR', 'WORKER', 'QUALITY_INSPECTOR', 'SERVICE_ENGINEER', 'DEALER', 'VEHICLE_OWNER'].map(role => {
                        const isChecked = policyAllowedRoles.includes(role);
                        return (
                          <label key={role} className="flex items-center gap-3 text-xs text-gray-300 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isChecked}
                              onChange={() => toggleAllowedRole(role)}
                              className="w-4 h-4 rounded bg-[#121620] border-white/20 text-[#3b82f6] focus:ring-0"
                            />
                            {role.replace('_', ' ')}
                          </label>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">3. Automated WhatsApp Warning Alerts</h3>
                        <p className="text-[10px] text-gray-500 mt-1">Send repeating reminders on unresolved defects directly to operator mobile numbers</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={policyWhatsappEnabled}
                          onChange={e => setPolicyWhatsappEnabled(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#3b82f6]"></div>
                      </label>
                    </div>

                    {policyWhatsappEnabled && (
                      <div className="space-y-4 bg-[#111522] p-4 rounded-xl border border-white/5">
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-2">WhatsApp Sender API Key (Twilio/Cloud API)</label>
                          <input
                            type="password"
                            value={policyWhatsappApiKey}
                            onChange={e => setPolicyWhatsappApiKey(e.target.value)}
                            placeholder="API Access Key Token"
                            className="w-full bg-[#121620] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none"
                          />
                        </div>
                        <div>
                          <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-2">Registered Sender Phone Number</label>
                          <input
                            type="text"
                            value={policyWhatsappSenderNum}
                            onChange={e => setPolicyWhatsappSenderNum(e.target.value)}
                            placeholder="e.g. +14155238886"
                            className="w-full bg-[#121620] border border-white/10 rounded-lg px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">4. Tenant Subscription Tier</h3>
                    <div className="flex items-center gap-3">
                      <select
                        value={policyTier}
                        onChange={e => setPolicyTier(e.target.value)}
                        className="bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] w-48 text-xs font-semibold"
                      >
                        <option value="BASIC">BASIC TIER</option>
                        <option value="PREMIUM">PREMIUM TIER</option>
                      </select>
                      <span className="text-xs text-gray-400">
                        Gates availability of advanced features.
                      </span>
                    </div>
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="text-xs font-bold text-white uppercase tracking-wider">5. Tenant Suspension Status</h3>
                        <p className="text-[10px] text-gray-500 mt-1">Enable or disable this client entire workspace access</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={policyIsActive}
                          onChange={e => setPolicyIsActive(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-[#e11d48]"></div>
                      </label>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-xs font-bold text-white uppercase tracking-wider mb-3">6. Alert Engine Custom Rulebook (JSON Profile)</h3>
                    <div className="space-y-4 bg-[#111522] p-4 rounded-xl border border-white/5">
                      <div>
                        <label className="block text-[10px] font-semibold text-gray-400 uppercase mb-2">Rulebook Configuration JSON</label>
                        <textarea
                          rows={12}
                          value={typeof policyRulebook === 'object' ? JSON.stringify(policyRulebook, null, 2) : policyRulebook}
                          onChange={e => setPolicyRulebook(e.target.value)}
                          className="w-full bg-[#121620] border border-white/10 rounded-lg px-3 py-2 text-xs text-white font-mono placeholder-gray-600 focus:outline-none"
                        />
                        <span className="text-[10px] text-gray-500 mt-1 block">
                          Configure dynamic properties like <code>workerAlertsEnabled</code>, <code>categoriesEnabled</code>, <code>escalation</code>, etc.
                        </span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    className="w-full btn-premium grad-primary py-3 rounded-xl font-semibold hover:opacity-90 text-white shadow-lg"
                  >
                    Save Policy Configuration
                  </button>
                </form>
              </div>
            )}
          </div>
        )}

        {/* AI Defect Clustering Tab Content */}
        {activeTab === 'ai-clustering' && (
          <div className="space-y-8 animate-fadeIn">
            {/* Header / Intro */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 glass-panel p-8 rounded-2xl border border-white/5 shadow-xl relative overflow-hidden">
              <div className="absolute top-0 left-0 w-full h-[3px] bg-gradient-to-r from-[#3b82f6] to-[#8b5cf6]"></div>
              <div>
                <h2 className="text-xl font-bold text-white mb-2" style={{ fontFamily: 'var(--font-title)' }}>
                  AI Defect Clustering & STT Diagnostics
                </h2>
                <p className="text-xs text-gray-400">
                  Clean noisy logs and group semantically similar defects to identify recurring quality trends.
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleSyncPythonToDb}
                  disabled={isSyncingDb || pythonCleanedDefects.length === 0}
                  className="flex items-center gap-2 px-4 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 text-white rounded-xl text-xs font-bold transition-all shadow-md disabled:opacity-50"
                >
                  <CheckCircle className={`w-3.5 h-3.5 ${isSyncingDb ? 'animate-pulse' : ''}`} />
                  {isSyncingDb ? 'Syncing to DB...' : 'Sync Cleaned Defects to DB'}
                </button>
                <button
                  onClick={fetchPythonData}
                  disabled={isFetchingPythonData}
                  className="flex items-center gap-2 px-4 py-2.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white rounded-xl text-xs font-semibold transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isFetchingPythonData ? 'animate-spin' : ''}`} />
                  {isFetchingPythonData ? 'Refreshing...' : 'Refresh Diagnostic Data'}
                </button>
              </div>
            </div>

            {/* Run Operations Section */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="glass-panel p-6 rounded-2xl border border-white/5 relative overflow-hidden">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">1. Qwen Log Cleaner</h3>
                    <p className="text-[10px] text-gray-500 mt-1">Cleans speech-to-text typos, slang, and maps multiple defects</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    pythonStatus?.tasks?.cleaner?.status === 'running' 
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : pythonStatus?.tasks?.cleaner?.status === 'success'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : pythonStatus?.tasks?.cleaner?.status === 'failed'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-gray-800 text-gray-400 border border-gray-700'
                  }`}>
                    {pythonStatus?.tasks?.cleaner?.status || 'idle'}
                  </span>
                </div>
                <button
                  onClick={handleRunPythonClean}
                  disabled={pythonActionLoading !== null || pythonStatus?.tasks?.cleaner?.status === 'running'}
                  className="w-full btn-premium bg-gradient-to-r from-blue-600 to-indigo-600 py-2.5 rounded-xl text-xs font-bold text-white hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {pythonActionLoading === 'cleaning' ? 'Triggering Cleaner...' : 'Run Cleaner Script'}
                </button>
                {pythonStatus?.tasks?.cleaner?.error && (
                  <p className="text-[10px] text-rose-400 mt-2 font-mono">{pythonStatus.tasks.cleaner.error}</p>
                )}
              </div>

              <div className="glass-panel p-6 rounded-2xl border border-white/5 relative overflow-hidden">
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-sm font-bold text-white uppercase tracking-wider">2. Semantic Embeddings & Clustering</h3>
                    <p className="text-[10px] text-gray-500 mt-1">Runs Agglomerative Clustering using Sentence Transformer embeddings</p>
                  </div>
                  <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                    pythonStatus?.tasks?.clustering?.status === 'running' 
                      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                      : pythonStatus?.tasks?.clustering?.status === 'success'
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                      : pythonStatus?.tasks?.clustering?.status === 'failed'
                      ? 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
                      : 'bg-gray-800 text-gray-400 border border-gray-700'
                  }`}>
                    {pythonStatus?.tasks?.clustering?.status || 'idle'}
                  </span>
                </div>
                <button
                  onClick={handleRunPythonCluster}
                  disabled={pythonActionLoading !== null || pythonStatus?.tasks?.clustering?.status === 'running'}
                  className="w-full btn-premium bg-gradient-to-r from-purple-600 to-pink-600 py-2.5 rounded-xl text-xs font-bold text-white hover:opacity-90 transition-all disabled:opacity-50"
                >
                  {pythonActionLoading === 'clustering' ? 'Triggering Clustering...' : 'Run Clustering Script'}
                </button>
                {pythonStatus?.tasks?.clustering?.error && (
                  <p className="text-[10px] text-rose-400 mt-2 font-mono">{pythonStatus.tasks.clustering.error}</p>
                )}
              </div>
            </div>

            {/* Sub-tab selectors */}
            <div className="flex border-b border-white/5 gap-6">
              <button
                onClick={() => setPythonSubTab('grouped')}
                className={`pb-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
                  pythonSubTab === 'grouped' ? 'border-[#3b82f6] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Grouped Clusters ({pythonGroupedDefects.length})
              </button>
              <button
                onClick={() => setPythonSubTab('cleaned')}
                className={`pb-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
                  pythonSubTab === 'cleaned' ? 'border-[#3b82f6] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Cleaned Defect Dictionary ({pythonCleanedDefects.length})
              </button>
              <button
                onClick={() => setPythonSubTab('raw')}
                className={`pb-3 text-xs font-semibold uppercase tracking-wider border-b-2 transition-all ${
                  pythonSubTab === 'raw' ? 'border-[#3b82f6] text-white' : 'border-transparent text-gray-500 hover:text-gray-300'
                }`}
              >
                Raw Diagnostic Logs ({pythonRawDefects.length})
              </button>
            </div>

            {/* Tab content area */}
            {isFetchingPythonData ? (
              <div className="p-12 text-center text-gray-400 flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-8 h-8 text-[#3b82f6] animate-spin" />
                <span className="text-xs font-semibold uppercase tracking-wider">Syncing Defect Data...</span>
              </div>
            ) : (
              <div className="space-y-6">
                {/* 1. Grouped Defects */}
                {pythonSubTab === 'grouped' && (
                  pythonGroupedDefects.length === 0 ? (
                    <div className="glass-panel p-12 text-center text-gray-500 text-xs rounded-2xl border border-white/5">
                      No groups generated yet. Please run the Semantic Clustering script above.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                      {pythonGroupedDefects.map((g, idx) => (
                        <div key={idx} className="glass-panel p-6 rounded-2xl border border-white/5 hover:border-white/10 transition-all flex flex-col justify-between">
                          <div>
                            <div className="flex items-center gap-2 mb-3">
                              <span className="w-2.5 h-2.5 rounded-full bg-[#a855f7]"></span>
                              <h4 className="text-sm font-bold text-white">Group {g.group}</h4>
                            </div>
                            <ul className="space-y-2">
                              {g.defects.map((d: string, dIdx: number) => (
                                <li key={dIdx} className="text-xs text-gray-300 bg-white/5 px-3 py-2 rounded-lg border border-white/5 font-mono">
                                  - {d}
                                </li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}

                {/* 2. Cleaned Defect Dictionary */}
                {pythonSubTab === 'cleaned' && (
                  pythonCleanedDefects.length === 0 ? (
                    <div className="glass-panel p-12 text-center text-gray-500 text-xs rounded-2xl border border-white/5">
                      No cleaned defects found. Please run the Qwen cleaner script above.
                    </div>
                  ) : (
                    <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
                      <div className="p-4 bg-[#111522] border-b border-white/5">
                        <h4 className="text-xs font-bold text-white uppercase tracking-wider">Official Cleaned Defect Dictionary</h4>
                      </div>
                      <div className="divide-y divide-white/5 max-h-[500px] overflow-y-auto">
                        {pythonCleanedDefects.map((d, idx) => (
                          <div key={idx} className="p-3.5 text-xs font-mono text-gray-300 hover:bg-white/5 transition-all">
                            {idx + 1}. {d}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                )}

                {/* 3. Raw Logs */}
                {pythonSubTab === 'raw' && (
                  pythonRawDefects.length === 0 ? (
                    <div className="glass-panel p-12 text-center text-gray-500 text-xs rounded-2xl border border-white/5">
                      No raw logs found in data directory.
                    </div>
                  ) : (
                    <div className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
                      <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                        <table className="w-full text-left text-xs border-collapse">
                          <thead>
                            <tr className="bg-[#111522] border-b border-white/5 text-gray-400 font-bold uppercase tracking-wider">
                              <th className="p-4">ID</th>
                              <th className="p-4">Raw Defect Log Message</th>
                              <th className="p-4">Rework Station</th>
                              <th className="p-4">STT Speech Variants Mapped</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/5 text-gray-300 font-medium">
                            {pythonRawDefects.map((r, idx) => (
                              <tr key={idx} className="hover:bg-white/5 transition-all">
                                <td className="p-4 font-mono">{r.id}</td>
                                <td className="p-4 font-semibold text-white">{r.defectName}</td>
                                <td className="p-4">Rework Shop: {r.reworkStationId}</td>
                                <td className="p-4">
                                  <div className="flex flex-wrap gap-1.5">
                                    {r.mispronouncedWords?.map((w: string, wIdx: number) => (
                                      <span key={wIdx} className="bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded text-[10px] font-mono">
                                        {w}
                                      </span>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}

        {/* Global Company Matrix Tab Content */}
        {activeTab === 'companies' && userProfile?.role === 'SUPER_ADMIN' && (
          <div className="space-y-8 animate-fadeIn">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Companies List Matrix */}
              <div className="glass-panel p-6 lg:col-span-2 rounded-2xl border border-white/5">
                <h3 className="text-lg font-bold text-white mb-2" style={{ fontFamily: 'var(--font-title)' }}>
                  Global Company Matrix
                </h3>
                <p className="text-xs text-gray-400 mb-6">
                  Monitor registered company tenants, user allocations, and active repair tickets across the system
                </p>

                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/5 text-gray-400 text-xs uppercase tracking-wider">
                        <th className="py-4 px-4">Company Name</th>
                        <th className="py-4 px-4">Total Users</th>
                        <th className="py-4 px-4">Open Alerts</th>
                        <th className="py-4 px-4">Created Date</th>
                        <th className="py-4 px-4">Status</th>
                        <th className="py-4 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs text-gray-300">
                      {companies && companies.length > 0 ? (
                        companies.map(c => (
                          <tr key={c.id} className="hover:bg-white/5 transition-all">
                            <td className="py-4 px-4 font-semibold text-white">
                              <span className="block text-sm">{c.name}</span>
                              <span className="text-[9px] text-gray-500 font-mono block truncate max-w-[120px]">{c.id}</span>
                            </td>
                            <td className="py-4 px-4 text-gray-400">{c.userCount} Users</td>
                            <td className="py-4 px-4 font-semibold text-amber-500">{c.openAlertCount} Active</td>
                            <td className="py-4 px-4 text-gray-500 font-medium">{new Date(c.createdAt).toLocaleDateString()}</td>
                            <td className="py-4 px-4">
                              <span className={`px-2.5 py-1 rounded-md text-[10px] font-bold ${
                                c.isActive 
                                  ? 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40' 
                                  : 'bg-red-950/40 text-red-500 border border-red-900/40'
                              }`}>
                                {c.isActive ? 'Active' : 'Suspended'}
                              </span>
                            </td>
                            <td className="py-4 px-4 text-right space-x-2">
                              <button
                                onClick={() => {
                                  setSelectedCompanyId(c.id);
                                  localStorage.setItem('vams_admin_selected_company_id', c.id);
                                  setActiveTab('overview');
                                }}
                                className="px-3 py-1.5 bg-blue-950/40 text-[#3b82f6] border border-blue-900/40 rounded-xl hover:bg-blue-900/30 font-semibold text-[10px] transition-all"
                              >
                                Scope Workspace
                              </button>
                              <button
                                onClick={() => toggleCompanyActive(c.id, c.isActive)}
                                className={`px-3 py-1.5 rounded-xl border text-[10px] font-semibold transition-all ${
                                  c.isActive 
                                    ? 'bg-red-950/40 text-red-500 border-red-900/40 hover:bg-red-900/30'
                                    : 'bg-emerald-950/40 text-emerald-500 border-emerald-900/40 hover:bg-emerald-900/30'
                                }`}
                              >
                                {c.isActive ? 'Suspend' : 'Activate'}
                              </button>
                            </td>
                          </tr>
                        ))
                      ) : (
                        <tr>
                          <td colSpan={6} className="py-10 text-center text-gray-500">No company tenants registered</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Create Company Form */}
              <div className="glass-panel p-6 rounded-2xl border border-white/5">
                <h3 className="text-lg font-bold text-white mb-2" style={{ fontFamily: 'var(--font-title)' }}>
                  Register New Company
                </h3>
                <p className="text-xs text-gray-400 mb-6">
                  Provision a new company tenant with default system settings
                </p>

                <form onSubmit={handleCreateCompany} className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Company Name
                    </label>
                    <input
                      type="text"
                      required
                      value={newCompanyName}
                      onChange={e => setNewCompanyName(e.target.value)}
                      placeholder="e.g. Ashok Leyland, Volvo, etc."
                      className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white placeholder-gray-500 focus:outline-none focus:border-[#3b82f6] transition-all"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
                      Max User License Cap
                    </label>
                    <input
                      type="number"
                      min="0"
                      value={newCompanyMaxUsers}
                      onChange={e => setNewCompanyMaxUsers(parseInt(e.target.value, 10))}
                      className="w-full bg-[#121620] border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:border-[#3b82f6] transition-all"
                    />
                    <span className="text-[10px] text-gray-500 mt-1 block">0 indicates unlimited registered users</span>
                  </div>

                  {newCompanySuccess && (
                    <div className="flex items-center gap-2 p-3 bg-emerald-950/40 border border-emerald-900/50 rounded-xl text-xs text-emerald-400">
                      <CheckCircle className="w-4 h-4 shrink-0" />
                      <span>{newCompanySuccess}</span>
                    </div>
                  )}

                  {newCompanyError && (
                    <div className="flex items-center gap-2 p-3 bg-red-950/40 border border-red-900/50 rounded-xl text-xs text-red-400">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>{newCompanyError}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    className="w-full btn-premium grad-primary py-3 rounded-xl font-semibold hover:opacity-90 mt-2 text-white shadow-lg"
                  >
                    Register Company
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>
      {/* Telemetry Inspector Modal */}
      {telemetryModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="glass-panel w-full max-w-5xl max-h-[90vh] flex flex-col rounded-3xl border border-white/10 shadow-2xl overflow-hidden relative">
            {/* Modal Header */}
            <div className="p-6 border-b border-white/10 flex flex-wrap items-center justify-between gap-4 bg-[#0e121c]/90">
              <div>
                <div className="flex items-center gap-2">
                  <Activity className="w-5 h-5 text-blue-500" />
                  <h2 className="text-xl font-bold text-white tracking-tight" style={{ fontFamily: 'var(--font-title)' }}>
                    {telemetryFilter === 'ALL' && 'Total Lifetime Defects'}
                    {telemetryFilter === 'OPEN' && 'Open & In-Progress Defects'}
                    {telemetryFilter === 'RESOLVED' && 'Resolved & Closed Defects'}
                    {telemetryFilter === 'REOPENED' && 'Reopened Recurrent Defects'}
                    {telemetryFilter === 'REASSIGNED' && 'Reassigned & Handover Defects'}
                  </h2>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-bold border ${
                    telemetryFilter === 'ALL' ? 'bg-blue-500/10 border-blue-500/20 text-blue-400' :
                    telemetryFilter === 'OPEN' ? 'bg-amber-500/10 border-amber-500/20 text-amber-400' :
                    telemetryFilter === 'RESOLVED' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400' :
                    telemetryFilter === 'REOPENED' ? 'bg-rose-500/10 border-rose-500/20 text-rose-400' :
                    'bg-sky-500/10 border-sky-500/20 text-sky-400'
                  }`}>
                    {filteredTelemetryAlerts.length} Defects Found
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-1">
                  {telemetryFilter === 'ALL' && 'Showing all cumulative lifetime defect alerts across the system'}
                  {telemetryFilter === 'OPEN' && 'Showing only active defects awaiting engineering resolution'}
                  {telemetryFilter === 'RESOLVED' && 'Showing only successfully closed and verified defect tasks'}
                  {telemetryFilter === 'REOPENED' && 'Showing only recurrent faults that were reopened'}
                  {telemetryFilter === 'REASSIGNED' && 'Showing defects that underwent operator reassignment or handovers'}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={() => handleTelemetryCardClick(telemetryFilter)}
                  title="Refresh telemetry"
                  className="p-2 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-all flex items-center gap-1 text-xs"
                >
                  <RefreshCw className={`w-4 h-4 ${isLoadingTelemetryAlerts ? 'animate-spin text-blue-400' : ''}`} />
                  <span className="hidden sm:inline">Refresh</span>
                </button>
                <button
                  onClick={() => setTelemetryModalOpen(false)}
                  className="p-2 text-gray-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-xl border border-white/5 transition-all"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Search Bar */}
            <div className="px-6 py-3 border-b border-white/5 bg-[#090b10] flex items-center justify-between gap-4">
              <div className="relative flex-1">
                <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={telemetrySearch}
                  onChange={e => setTelemetrySearch(e.target.value)}
                  placeholder={`Search within ${telemetryFilter.toLowerCase()} defects by VIN, name, operator, or tenant...`}
                  className="w-full bg-[#121620] border border-white/10 rounded-xl pl-9 pr-4 py-2 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-blue-500 transition-all"
                />
                {telemetrySearch && (
                  <button onClick={() => setTelemetrySearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Table Body */}
            <div className="p-6 overflow-y-auto max-h-[60vh]">
              {isLoadingTelemetryAlerts ? (
                <div className="flex flex-col items-center justify-center py-16 text-gray-400">
                  <RefreshCw className="w-8 h-8 animate-spin text-blue-500 mb-3" />
                  <p className="text-xs font-medium">Fetching telemetry records...</p>
                </div>
              ) : filteredTelemetryAlerts.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="border-b border-white/10 text-gray-400 text-[10px] uppercase tracking-wider">
                        <th className="py-3 px-4">VIN Number</th>
                        <th className="py-3 px-4">Defect Name</th>
                        <th className="py-3 px-4">Tenant / Workspace</th>
                        <th className="py-3 px-4 text-center">Severity</th>
                        <th className="py-3 px-4 text-center">Status</th>
                        <th className="py-3 px-4">Assigned Operator</th>
                        <th className="py-3 px-4 text-right">Created Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-xs text-gray-300">
                      {filteredTelemetryAlerts.map((a: any) => {
                        let sevClass = 'bg-gray-800 text-gray-400';
                        if (a.severity === 'HIGH') sevClass = 'bg-orange-950/40 text-orange-400 border border-orange-900/40';
                        else if (a.severity === 'CRITICAL' || a.severity === 'EMERGENCY') sevClass = 'bg-red-950/40 text-red-400 border border-red-900/40';
                        else if (a.severity === 'MEDIUM') sevClass = 'bg-yellow-950/40 text-yellow-500 border border-yellow-900/40';

                        let statClass = 'bg-gray-800 text-gray-300';
                        if (a.status === 'OPEN') statClass = 'bg-blue-950/40 text-blue-400 border border-blue-900/40';
                        else if (a.status === 'IN_PROGRESS') statClass = 'bg-amber-950/40 text-amber-500 border border-amber-900/40';
                        else if (a.status === 'RESOLVED') statClass = 'bg-emerald-950/40 text-emerald-500 border border-emerald-900/40';
                        else if (a.status === 'REOPENED') statClass = 'bg-rose-950/40 text-rose-500 border border-rose-900/40';
                        else if (a.status === 'REASSIGNED') statClass = 'bg-sky-950/40 text-sky-400 border border-sky-900/40';

                        return (
                          <tr key={a.id} className="hover:bg-white/5 transition-all">
                            <td className="py-3.5 px-4 font-mono font-bold text-white">{a.vin || 'SYSTEM_AUTO'}</td>
                            <td className="py-3.5 px-4 font-medium text-white">{a.defectName}</td>
                            <td className="py-3.5 px-4 text-gray-400 font-medium">{a.company?.name || 'Default Workspace'}</td>
                            <td className="py-3.5 px-4 text-center">
                              <span className={`px-2.5 py-0.5 rounded text-[9px] font-bold ${sevClass}`}>
                                {a.severity}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 text-center">
                              <span className={`px-2.5 py-0.5 rounded text-[9px] font-bold ${statClass}`}>
                                {a.status}
                              </span>
                            </td>
                            <td className="py-3.5 px-4 font-medium text-gray-300">
                              {a.assignedToUser ? `${a.assignedToUser.name} (${a.assignedToUser.role})` : 'Dynamic / Unassigned'}
                            </td>
                            <td className="py-3.5 px-4 text-right text-gray-500 font-medium">
                              {new Date(a.createdAt).toLocaleString()}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                  <AlertTriangle className="w-8 h-8 text-gray-600 mb-2" />
                  <p className="text-xs font-semibold">No telemetry alert records found matching this category or search query.</p>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-white/10 bg-[#0e121c] flex justify-between items-center text-xs text-gray-400">
              <span>Showing {filteredTelemetryAlerts.length} telemetry records</span>
              <button
                onClick={() => setTelemetryModalOpen(false)}
                className="px-4 py-2 bg-gray-800 hover:bg-gray-700 text-white rounded-xl font-semibold transition-all"
              >
                Close Inspector
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
