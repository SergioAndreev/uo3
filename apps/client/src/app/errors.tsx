import { Component, type ReactNode } from 'react';
import { Button, Notice } from '@duskmarch/ui-kit';
import { diagnosticReport, reportText, type DiagnosticReport } from './diagnostics.js';

export type BoundaryLevel = 'root' | 'screen' | 'viewport';

interface Props {
  level: BoundaryLevel;
  route: () => string;
  clientVersion: string;
  children: ReactNode;
  onRecover?: () => void;
  onReport?: (report: DiagnosticReport) => void;
}

interface State {
  failed: boolean;
  report: DiagnosticReport | null;
}

/** Предохранитель уровня: корень, экран или вьюпорт. Отчёт очищен от токенов и персональных данных. */
export class ErrorBoundary extends Component<Props, State> {
  override state: State = { failed: false, report: null };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  override componentDidCatch(error: unknown): void {
    const report = diagnosticReport(error, {
      route: this.props.route(),
      clientVersion: this.props.clientVersion,
    });
    this.setState({ report });
    this.props.onReport?.(report);
  }

  private copy = () => {
    if (this.state.report) void navigator.clipboard?.writeText(reportText(this.state.report));
  };

  override render(): ReactNode {
    const { failed, report } = this.state;
    if (!failed) return this.props.children;
    const code = report?.correlationId ?? '…';
    if (this.props.level === 'root') {
      return (
        <main data-boundary="root">
          <p>Клиент столкнулся с ошибкой. Код: {code}</p>
          <button type="button" onClick={() => location.reload()}>
            Перезагрузить клиент
          </button>
        </main>
      );
    }
    return (
      <div data-boundary={this.props.level}>
        <Notice tone="error">Не удалось показать экран. Код инцидента: {code}</Notice>
        <Button onClick={this.copy} variant="ghost">
          Скопировать диагностику
        </Button>
        <Button
          onClick={() => {
            this.setState({ failed: false, report: null });
            this.props.onRecover?.();
          }}
        >
          {this.props.level === 'viewport' ? 'К выбору героя' : 'К шардам'}
        </Button>
      </div>
    );
  }
}
