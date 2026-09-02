import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import MessagePoller from './components/MessagePoller'
import type { ReactNode } from 'react'
import { Spin } from '@chaos_team/chaos-ui'
import Login from './pages/Login'
import Files from './pages/Files'
import Preview from './pages/Preview'
import Archive from './pages/Archive'
import ManageLayout from './pages/manage/ManageLayout'
import ManageStorages from './pages/manage/Storages'
import ManageUsers from './pages/manage/Users'
import ManageSettings from './pages/manage/Settings'
import ManageTasks from './pages/manage/Tasks'
import ManageShares from './pages/manage/Shares'
import ManageS3Keys from './pages/manage/S3Keys'
import ManageS3Audit from './pages/manage/S3Audit'
import ManageS3Buckets from './pages/manage/S3Buckets'
import Share from './pages/Share'
import Profile from './pages/Profile'
import { USER_ROLE } from './api/types'

function FullscreenLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <Spin size="lg" label="Loading" />
    </div>
  )
}

/** Blocks rendering until auth state is resolved; redirects to /login. */
function RequireAuth({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth()
  const location = useLocation()
  if (initializing) return <FullscreenLoading />
  if (!user) {
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    )
  }
  return <>{children}</>
}

/** Admin-only area under /admin. */
function RequireAdmin({ children }: { children: ReactNode }) {
  const { user, initializing } = useAuth()
  const location = useLocation()
  if (initializing) return <FullscreenLoading />
  if (!user) {
    return (
      <Navigate
        to={`/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    )
  }
  if (user.role !== USER_ROLE.ADMIN) {
    return <Navigate to="/files" replace />
  }
  return <>{children}</>
}

/** Only poll announcements for logged-in admins (the endpoint is admin-only). */
function MessagePollerGate() {
  const { user } = useAuth()
  return <MessagePoller enabled={!!user && user.role === 2} />
}

export default function App() {
  return (
    <>
      <MessagePollerGate />
      <Routes>
      <Route path="/login" element={<Login />} />

      <Route
        path="/files"
        element={
          <RequireAuth>
            <Files />
          </RequireAuth>
        }
      />
      <Route
        path="/files/*"
        element={
          <RequireAuth>
            <Files />
          </RequireAuth>
        }
      />

      <Route
        path="/preview"
        element={
          <RequireAuth>
            <Preview />
          </RequireAuth>
        }
      />

      {/* public share pages — no login required */}
      <Route path="/s/:sid" element={<Share />} />
      <Route path="/s/:sid/*" element={<Share />} />
      <Route path="/spreview" element={<Preview />} />

      <Route
        path="/archive"
        element={
          <RequireAuth>
            <Archive />
          </RequireAuth>
        }
      />

      <Route
        path="/profile"
        element={
          <RequireAuth>
            <Profile />
          </RequireAuth>
        }
      />

      <Route
        path="/admin"
        element={
          <RequireAdmin>
            <ManageLayout />
          </RequireAdmin>
        }
      >
        <Route index element={<Navigate to="storages" replace />} />
        <Route path="storages" element={<ManageStorages />} />
        <Route path="users" element={<ManageUsers />} />
        <Route path="tasks" element={<ManageTasks />} />
        <Route path="shares" element={<ManageShares />} />
        <Route path="settings" element={<ManageSettings />} />
        <Route path="s3buckets" element={<ManageS3Buckets />} />
        <Route path="s3keys" element={<ManageS3Keys />} />
        <Route path="s3audit" element={<ManageS3Audit />} />
      </Route>

      {/* legacy OpenList-style URLs keep working */}
      <Route path="/@login" element={<Navigate to="/login" replace />} />
      <Route path="/@manage/*" element={<Navigate to="/admin/storages" replace />} />

      <Route path="/" element={<Navigate to="/files" replace />} />
      <Route path="/*" element={<Navigate to="/files" replace />} />
    </Routes>
    </>
  )
}
