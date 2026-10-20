import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '../api';

// Users list shared by the sidebar quick-add and the Manage users page.
export default function useUsers(enabled) {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await apiFetch('/api/auth/users'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (enabled) reload();
  }, [enabled, reload]);

  // Each action returns the server response and refreshes the list
  const addUser = async ({ name, email, role }) => {
    const data = await apiFetch('/api/auth/register', { method: 'POST', body: { name, email, role } });
    await reload();
    return data; // { user, tempPassword }
  };

  const updateUser = async (id, { name, email, role }) => {
    const data = await apiFetch(`/api/auth/users/${id}`, { method: 'PUT', body: { name, email, role } });
    await reload();
    return data;
  };

  const deleteUser = async (id) => {
    const data = await apiFetch(`/api/auth/users/${id}`, { method: 'DELETE' });
    await reload();
    return data;
  };

  const resetPassword = (id) => apiFetch(`/api/auth/users/${id}/reset-password`, { method: 'POST' });

  return { users, loading, error, reload, addUser, updateUser, deleteUser, resetPassword };
}