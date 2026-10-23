import { useMutation, useQuery } from "@tanstack/react-query";
import { useRef, useState, type FormEvent } from "react";
import { Link } from "react-router";
import { useAuth } from "../auth/authContext";
import { Alert } from "../components/Alert";
import { PageLoader } from "../components/PageLoader";
import { Spinner } from "../components/Spinner";
import { TextField } from "../components/TextField";
import { usePageTitle } from "../hooks/usePageTitle";
import { queryKeys } from "../lib/queryKeys";
import {
  PASSWORD_HINT,
  fieldErrorsFromApi,
  focusFirstInvalid,
  formErrorMessage,
  hasErrors,
  validateEmail,
  validateName,
  validateNewPassword,
  validateRequired,
  type FieldErrors,
} from "../lib/validation";
import { paths } from "../routes/paths";
import { toApiError } from "../services/apiError";
import { authService } from "../services/authService";

type Field = "setupToken" | "name" | "email" | "password" | "confirmPassword";
type Values = Record<Field, string>;

function validate(values: Values): FieldErrors<Field> {
  return {
    setupToken: validateRequired(values.setupToken, "the setup token"),
    name: validateName(values.name),
    email: validateEmail(values.email),
    password: validateNewPassword(values.password),
    confirmPassword: values.confirmPassword === values.password ? undefined : "Passwords don't match",
  };
}

export default function SetupPage() {
  usePageTitle("Set up StockPilot");
  const status = useQuery({
    queryKey: queryKeys.auth.setupStatus,
    queryFn: ({ signal }) => authService.getSetupStatus(signal),
  });

  if (status.isPending) return <PageLoader message="Checking setup status…" />;
  if (status.isError) {
    return (
      <div className="login">
        <Alert tone="error">{toApiError(status.error).message}</Alert>
        <button type="button" className="button button--ghost" onClick={() => void status.refetch()}>
          Try again
        </button>
      </div>
    );
  }
  if (!status.data.setupRequired) {
    return (
      <div className="login">
        <h1 className="login__title">Already set up</h1>
        <p className="login__subtitle">This StockPilot workspace already has an owner.</p>
        <Link to={paths.login} className="button button--block">
          Go to sign in
        </Link>
      </div>
    );
  }
  if (!status.data.setupEnabled) {
    return (
      <div className="login">
        <h1 className="login__title">Setup is locked</h1>
        <Alert tone="warn">
          Set <code>SETUP_TOKEN</code> in <code>backend/.env</code> to a random value of at least 32 characters, then
          restart the API and reload this page.
        </Alert>
      </div>
    );
  }
  return <SetupForm />;
}

function SetupForm() {
  const { setupOwner } = useAuth();
  const formRef = useRef<HTMLFormElement>(null);
  const [values, setValues] = useState<Values>({ setupToken: "", name: "", email: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<FieldErrors<Field>>({});
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: setupOwner,
    onError: (error) => setErrors(fieldErrorsFromApi(error)),
  });

  function update(field: Field, value: string) {
    const next = { ...values, [field]: value };
    setValues(next);
    if (submitted) setErrors(validate(next));
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitted(true);
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (hasErrors(nextErrors)) {
      focusFirstInvalid(formRef.current);
      return;
    }
    const { confirmPassword: _, ...input } = values;
    mutation.mutate({ ...input, setupToken: input.setupToken.trim(), email: input.email.trim() });
  }

  const pending = mutation.isPending;
  const formError = formErrorMessage(mutation.error);
  const field = (name: Field) => ({
    name,
    value: values[name],
    onChange: (event: { target: { value: string } }) => update(name, event.target.value),
    error: errors[name],
    disabled: pending,
  });

  return (
    <div className="login">
      <h1 className="login__title">Create the owner account</h1>
      <p className="login__subtitle">
        This one-time step creates the account that manages staff and settings. You'll need the setup token from the
        server configuration.
      </p>

      {formError && <Alert tone="error">{formError}</Alert>}

      <form ref={formRef} className="form" onSubmit={handleSubmit} noValidate aria-busy={pending}>
        <TextField label="Setup token" type="password" autoComplete="off" revealable autoFocus {...field("setupToken")} />
        <TextField label="Your name" autoComplete="name" {...field("name")} />
        <TextField label="Email" type="email" autoComplete="username" inputMode="email" {...field("email")} />
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          revealable
          hint={PASSWORD_HINT}
          {...field("password")}
        />
        <TextField label="Confirm password" type="password" autoComplete="new-password" {...field("confirmPassword")} />
        <button type="submit" className="button button--block" disabled={pending}>
          {pending && <Spinner size={14} label="Creating account" />}
          {pending ? "Creating account…" : "Create owner account"}
        </button>
      </form>
    </div>
  );
}
