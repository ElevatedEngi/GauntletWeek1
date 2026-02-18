import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import LoginPage from './components/Auth/LoginPage';
import BoardPage from './components/Board/BoardPage';
import CreateBoardPage from './components/Board/CreateBoardPage';
import useAuthStore from './stores/authStore';

function App() {
  const { isAuthenticated, isLoading, initAuth } = useAuthStore();

  useEffect(() => {
    initAuth();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-gradient-to-br from-blue-50 to-indigo-100">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-800 mb-4">Whiteboard AI</h1>
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Login — redirect to /board if already authenticated */}
        <Route
          path="/login"
          element={isAuthenticated ? <Navigate to="/board" replace /> : <LoginPage />}
        />

        {/* /board — creates a new board and redirects to /board/:id */}
        <Route
          path="/board"
          element={isAuthenticated ? <CreateBoardPage /> : <Navigate to="/login" replace />}
        />

        {/* /board/:id — loads and displays an existing board */}
        <Route
          path="/board/:id"
          element={isAuthenticated ? <BoardPage /> : <Navigate to="/login" replace />}
        />

        {/* Root — redirect based on auth state */}
        <Route
          path="/"
          element={isAuthenticated ? <Navigate to="/board" replace /> : <Navigate to="/login" replace />}
        />

        {/* Catch-all */}
        <Route
          path="*"
          element={<Navigate to={isAuthenticated ? '/board' : '/login'} replace />}
        />
      </Routes>
    </BrowserRouter>
  );
}

export default App;
