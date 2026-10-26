import { useEffect } from "react";
import { toast } from "sonner";

export function useNoticeToast(message: string | null) {
  useEffect(() => { if (message) toast.success(message, { id: message }); }, [message]);
}
