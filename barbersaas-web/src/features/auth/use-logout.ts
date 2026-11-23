import { useNavigate } from 'react-router';
import { authControllerLogout } from '@/api/generated/endpoints';
import { clearAllQueryClients } from '@/app/query-client';
import { useAuth } from '@/stores/auth';

export function useLogout() {
  const navigate = useNavigate();
  return async () => {
    const refreshToken = useAuth.getState().refreshToken;
    if (refreshToken) await authControllerLogout({ refreshToken }).catch(() => undefined);
    useAuth.getState().clear();
    clearAllQueryClients();
    navigate('/login', { replace: true });
  };
}
