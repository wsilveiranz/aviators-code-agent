/**
 * OpenTelemetry + Azure Monitor instrumentation.
 * Must be imported before any other module to ensure auto-instrumentation works.
 */

import { useAzureMonitor } from '@azure/monitor-opentelemetry';
import pkg from '@opentelemetry/resources';
const { Resource } = pkg;

const connectionString = process.env.APPLICATIONINSIGHTS_CONNECTION_STRING;

if (connectionString) {
  useAzureMonitor({
    azureMonitorExporterOptions: { connectionString },
    resource: new Resource({
      'service.name': 'aviators-newsletter-agent',
      'gen_ai.agent.id': 'aviators-newsletter-agent',
    }),
    instrumentationOptions: {
      http: { enabled: true },
      azureSdk: { enabled: true },
    },
  });
  console.log('[Telemetry] Application Insights enabled');
} else {
  console.log('[Telemetry] No APPLICATIONINSIGHTS_CONNECTION_STRING set, telemetry disabled');
}
