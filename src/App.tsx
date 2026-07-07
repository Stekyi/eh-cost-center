import React, { useEffect, useState } from 'react'
import { Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Drawer, SwipeableDrawer, List, ListItem, ListItemButton, ListItemIcon, ListItemText, Toolbar, AppBar, CssBaseline, Box, Divider, IconButton, useMediaQuery } from '@mui/material'
import { useTheme } from '@mui/material/styles'
import MenuIcon from '@mui/icons-material/Menu'
import DashboardIcon from '@mui/icons-material/Dashboard'
import PeopleIcon from '@mui/icons-material/People'
import InventoryIcon from '@mui/icons-material/Inventory'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import AddCircleIcon from '@mui/icons-material/AddCircle'
import AccountBalanceIcon from '@mui/icons-material/AccountBalance'
import GroupIcon from '@mui/icons-material/Group'
import ReceiptIcon from '@mui/icons-material/Receipt'
import RestaurantIcon from '@mui/icons-material/Restaurant'
import LocalDrinkIcon from '@mui/icons-material/LocalDrink'
import FactoryIcon from '@mui/icons-material/Factory'
import Login from './pages/Login'
import CustomersList from './pages/CustomersList'
import ProductsList from './pages/ProductsList'
import OrderBooking from './pages/OrderBooking'
import OrderDetail from './pages/OrderDetail'
import CustomerStatement from './pages/CustomerStatement'
import CustomerFollowUp from './pages/CustomerFollowUp'
import OrdersList from './pages/OrdersList'
import OrdersReport from './pages/OrdersReport'
import StaffList from './pages/StaffList'
import CostLedger from './pages/CostLedger'
import CostPlusMeal from './pages/CostPlusMeal'
import CostPlusJuice from './pages/CostPlusJuice'
import Assets from './pages/Assets'
import ProductionList from './pages/ProductionList'
import Dashboard from './pages/Dashboard'
import TopCustomers from './pages/TopCustomers'
import { onChange as onAuthChange, logout as authLogout, type AuthUser } from './utils/authClient'
import { RoleContext } from './utils/RoleContext'
import ExpenseCategories from './pages/ExpenseCategories'
import CustomerCategories from './pages/CustomerCategories'
import CustomerAllergies from './pages/CustomerAllergies'
import MediaLibrary from './pages/MediaLibrary'
import DeliveryAssignments from './pages/DeliveryAssignments'
import CreateDeliveryAssignment from './pages/CreateDeliveryAssignment'
import DeliveryView from './pages/DeliveryView'
import StarIcon from '@mui/icons-material/Star'
import PhotoLibraryIcon from '@mui/icons-material/PhotoLibrary'
import LocalShippingIcon from '@mui/icons-material/LocalShipping'
import ManageAccountsIcon from '@mui/icons-material/ManageAccounts'
import LockResetIcon from '@mui/icons-material/LockReset'
import ChatButton from './components/ChatButton'
import UsersAdmin from './pages/UsersAdmin'
import ChangePassword from './pages/ChangePassword'

type StaffRole = 'admin' | 'videographer' | 'assistant'

const ASSISTANT_ALLOWED_PATHS = ['/orders', '/orders-report', '/customer-followup', '/cust-insight', '/customers', '/costs']
function isAllowedForAssistant(path: string) {
  return ASSISTANT_ALLOWED_PATHS.some((p) => path === p || path.startsWith(p + '/'))
}

export default function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const theme = useTheme()
  const isSmUp = useMediaQuery(theme.breakpoints.up('sm'))
  const [authReady, setAuthReady] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [staffRole, setStaffRole] = useState<StaffRole | null>(null)
  const [desktopCollapsed, setDesktopCollapsed] = useState(false)
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)

  const isAdmin = staffRole === 'admin'
  const isVideographer = staffRole === 'videographer'
  const isAssistant = staffRole === 'assistant'
  const mediaAccess = isAdmin || isVideographer
  const defaultPath = isVideographer ? '/media' : isAssistant ? '/orders' : '/dashboard'

  useEffect(() => {
    const raw = localStorage.getItem('desktopSidebarCollapsed')
    setDesktopCollapsed(raw === '1')
  }, [])

  useEffect(() => {
    // Self-hosted auth: role comes directly from the JWT (user.role), no
    // getIdTokenResult round-trip. Fires immediately with the current user.
    const unsub = onAuthChange((u: AuthUser | null) => {
      setUser(u)
      const role = (u?.role as StaffRole | null) ?? null
      setStaffRole(role)
      setAuthReady(true)
      if (u && !role) {
        authLogout()
        navigate('/login', { replace: true })
      }
    })
    return () => unsub()
  }, [navigate])

  useEffect(() => {
    if (!authReady) return
    const path = location.pathname
    if (!user) {
      if (path !== '/' && path !== '/login' && !path.startsWith('/d/')) navigate('/login', { replace: true })
      return
    }
    if (!staffRole) return
    if (path === '/' || path === '/login') {
      navigate(defaultPath, { replace: true })
    }
  }, [authReady, defaultPath, location.pathname, navigate, staffRole, user])

  if (!authReady) return <div style={{ padding: 32 }}>Loading...</div>

  const ProtectedRoute = ({ allowMediaOnly = false, anyRole = false, children }: { allowMediaOnly?: boolean; anyRole?: boolean; children: React.ReactElement }) => {
    if (!user) return <Navigate to="/login" replace />
    if (anyRole) return children // any authenticated user (e.g. Change Password)
    if (isAssistant) return isAllowedForAssistant(location.pathname) ? children : <Navigate to="/orders" replace />
    if (allowMediaOnly ? mediaAccess : isAdmin) return children
    return <Navigate to={defaultPath} replace />
  }

  const iOS = typeof navigator !== 'undefined' && /iPad|iPhone|iPod/.test(navigator.userAgent)
  const drawerWidth = isSmUp ? (desktopCollapsed ? 72 : 220) : 0
  const showLabels = isSmUp && !desktopCollapsed || !isSmUp
  const assistantMenuItems = [
    { text: 'Orders', icon: <ShoppingCartIcon />, path: '/orders' },
    { text: 'New Order', icon: <AddCircleIcon />, path: '/orders/new' },
    { text: 'Orders Report', icon: <ReceiptIcon />, path: '/orders-report' },
    { text: 'Customers', icon: <PeopleIcon />, path: '/customers' },
    { text: 'Cust Insight', icon: <ReceiptIcon />, path: '/cust-insight' },
    { text: 'Customer Follow-Up', icon: <PeopleIcon />, path: '/customer-followup' },
    { text: 'Expense Items', icon: <ReceiptIcon />, path: '/costs' },
    { text: 'Change Password', icon: <LockResetIcon />, path: '/change-password' },
    { text: 'Logout', icon: <MenuIcon />, action: 'logout' },
  ]

  const menuItems = isVideographer
    ? [
        { text: 'Media Library', icon: <PhotoLibraryIcon />, path: '/media' },
        { text: 'Change Password', icon: <LockResetIcon />, path: '/change-password' },
        { text: 'Logout', icon: <MenuIcon />, action: 'logout' },
      ]
    : isAssistant
    ? assistantMenuItems
    : [
        { text: 'Dashboard', icon: <DashboardIcon />, path: '/dashboard' },
        { text: 'Customers', icon: <PeopleIcon />, path: '/customers' },
        { text: 'Cust Insight', icon: <ReceiptIcon />, path: '/cust-insight' },
        { text: 'Customer Follow-Up', icon: <PeopleIcon />, path: '/customer-followup' },
        { text: 'Products', icon: <InventoryIcon />, path: '/products' },
        { text: 'Orders', icon: <ShoppingCartIcon />, path: '/orders' },
        { text: 'Orders Report', icon: <ReceiptIcon />, path: '/orders-report' },
        { text: 'New Order', icon: <AddCircleIcon />, path: '/orders/new' },
        { text: 'Delivery', icon: <LocalShippingIcon />, path: '/delivery-assignments' },
        { text: 'Assets', icon: <AccountBalanceIcon />, path: '/assets' },
        { text: 'Staff', icon: <GroupIcon />, path: '/staff' },
        { text: 'Expense Items', icon: <ReceiptIcon />, path: '/costs' },
        ...(isAdmin ? [{ text: 'Expense Categories', icon: <ReceiptIcon />, path: '/expense-categories' }] : []),
        ...(isAdmin ? [{ text: 'Customer Categories', icon: <PeopleIcon />, path: '/customer-categories' }] : []),
        ...(isAdmin ? [{ text: 'Customer Allergies', icon: <PeopleIcon />, path: '/customer-allergies' }] : []),
        ...(isAdmin ? [{ text: 'Top Customers', icon: <StarIcon />, path: '/top-customers' }] : []),
        ...(mediaAccess ? [{ text: 'Media Library', icon: <PhotoLibraryIcon />, path: '/media' }] : []),
        { text: 'Cost-Plus Meal', icon: <RestaurantIcon />, path: '/costplus/meal' },
        { text: 'Cost-Plus Juice', icon: <LocalDrinkIcon />, path: '/costplus/juice' },
        { text: 'Production', icon: <FactoryIcon />, path: '/production' },
        ...(isAdmin ? [{ text: 'Users', icon: <ManageAccountsIcon />, path: '/users' }] : []),
        { text: 'Change Password', icon: <LockResetIcon />, path: '/change-password' },
        { text: 'Logout', icon: <MenuIcon />, action: 'logout' },
      ]

  const handleMenuClick = (item: any) => {
    if (item.action === 'logout') {
      authLogout()
      navigate('/login', { replace: true })
    } else if (item.path) {
      navigate(item.path)
    }
    // Close mobile drawer on navigation
    setMobileDrawerOpen(false)
  }

  const toggleDesktopSidebar = () => {
    setDesktopCollapsed((prev) => {
      const next = !prev
      localStorage.setItem('desktopSidebarCollapsed', next ? '1' : '0')
      return next
    })
  }

  const toggleMobileDrawer = () => {
    setMobileDrawerOpen((prev) => !prev)
  }

  const drawer = (
    <div>
      <Toolbar style={{ minHeight: 64 }}>
        <Box component="span" sx={{ fontWeight: 700, fontSize: 20, color: '#2563eb', letterSpacing: 1, whiteSpace: 'nowrap' }}>
          <Box component="span" sx={{ display: showLabels ? 'inline' : 'none' }}>EH Cost Center</Box>
          <Box component="span" sx={{ display: showLabels ? 'none' : 'inline' }}>EH</Box>
        </Box>
      </Toolbar>
      <Divider />
      <List>
        {menuItems.map((item) => (
          <ListItem disablePadding key={item.text}>
            <ListItemButton
              selected={location.pathname === item.path}
              onClick={() => handleMenuClick(item)}
              title={item.text}
              sx={{
                justifyContent: showLabels ? 'flex-start' : 'center',
                px: showLabels ? 2 : 1.5,
              }}
            >
              <ListItemIcon
                sx={{
                  minWidth: 0,
                  mr: showLabels ? 2 : 0,
                  justifyContent: 'center',
                }}
              >
                {item.icon}
              </ListItemIcon>
              <ListItemText primary={item.text} sx={{ display: showLabels ? 'block' : 'none' }} />
            </ListItemButton>
          </ListItem>
        ))}
      </List>
    </div>
  )

  return (
    <RoleContext.Provider value={staffRole}>
    <Box sx={{ display: 'flex', width: '100%', maxWidth: '100vw' }}>
      <CssBaseline />
      <AppBar position="fixed" sx={{ zIndex: (theme) => theme.zIndex.drawer + 1, background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)' }}>
        <Toolbar>
          <IconButton
            color="inherit"
            aria-label="open mobile drawer"
            edge="start"
            onClick={toggleMobileDrawer}
            sx={{ mr: 2, display: { xs: 'inline-flex', sm: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <IconButton
            color="inherit"
            aria-label={desktopCollapsed ? 'show menu' : 'hide menu'}
            edge="start"
            onClick={toggleDesktopSidebar}
            sx={{ mr: 2, display: { xs: 'none', sm: 'inline-flex' } }}
          >
            <MenuIcon />
          </IconButton>
          <span style={{ fontWeight: 700, fontSize: 20, letterSpacing: 1 }}>EH Cost Center</span>
        </Toolbar>
      </AppBar>
      <Box component="nav" sx={{ width: { sm: drawerWidth }, flexShrink: { sm: 0 } }} aria-label="menu folders">
        {/* Mobile drawer */}
        <SwipeableDrawer
          variant="temporary"
          open={mobileDrawerOpen}
          onClose={toggleMobileDrawer}
          onOpen={toggleMobileDrawer}
          disableBackdropTransition={!iOS}
          disableDiscovery={iOS}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: 'block', sm: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: 220 },
          }}
        >
          {drawer}
        </SwipeableDrawer>
        {/* Desktop drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth, overflowX: 'hidden' },
          }}
          open
        >
          {drawer}
        </Drawer>
      </Box>
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          width: '100%',
          maxWidth: '100%',
          p: { xs: 1.5, sm: 3 },
        }}
      >
        <Toolbar />
        <Routes>
          <Route path="/" element={<Login />} />
          <Route path="/login" element={<Login />} />
          <Route path="/dashboard" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute><CustomersList /></ProtectedRoute>} />
          <Route path="/cust-insight" element={<ProtectedRoute><CustomerStatement /></ProtectedRoute>} />
          <Route path="/customer-followup" element={<ProtectedRoute><CustomerFollowUp /></ProtectedRoute>} />
          <Route path="/products" element={<ProtectedRoute><ProductsList /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><OrdersList /></ProtectedRoute>} />
          <Route path="/orders-report" element={<ProtectedRoute><OrdersReport /></ProtectedRoute>} />
          <Route path="/orders/new" element={<ProtectedRoute><OrderBooking /></ProtectedRoute>} />
          <Route path="/orders/:id" element={<ProtectedRoute><OrderDetail /></ProtectedRoute>} />
          <Route path="/costplus/meal" element={<ProtectedRoute><CostPlusMeal /></ProtectedRoute>} />
          <Route path="/costplus/juice" element={<ProtectedRoute><CostPlusJuice /></ProtectedRoute>} />
          <Route path="/assets" element={<ProtectedRoute><Assets /></ProtectedRoute>} />
          <Route path="/staff" element={<ProtectedRoute><StaffList /></ProtectedRoute>} />
          <Route path="/costs" element={<ProtectedRoute><CostLedger /></ProtectedRoute>} />
          <Route path="/expense-categories" element={<ProtectedRoute><ExpenseCategories /></ProtectedRoute>} />
          <Route path="/customer-categories" element={<ProtectedRoute><CustomerCategories /></ProtectedRoute>} />
          <Route path="/customer-allergies" element={<ProtectedRoute><CustomerAllergies /></ProtectedRoute>} />
          <Route path="/production" element={<ProtectedRoute><ProductionList /></ProtectedRoute>} />
          <Route path="/top-customers" element={<ProtectedRoute><TopCustomers /></ProtectedRoute>} />
          <Route path="/media" element={<ProtectedRoute allowMediaOnly><MediaLibrary /></ProtectedRoute>} />
          <Route path="/delivery-assignments" element={<ProtectedRoute><DeliveryAssignments /></ProtectedRoute>} />
          <Route path="/delivery-assignments/new" element={<ProtectedRoute><CreateDeliveryAssignment /></ProtectedRoute>} />
          <Route path="/users" element={<ProtectedRoute><UsersAdmin /></ProtectedRoute>} />
          <Route path="/change-password" element={<ProtectedRoute anyRole><ChangePassword /></ProtectedRoute>} />
          <Route path="/d/:shortCode" element={<DeliveryView />} />
        </Routes>
        {isAdmin && <ChatButton />}
      </Box>
    </Box>
    </RoleContext.Provider>
  )
}
