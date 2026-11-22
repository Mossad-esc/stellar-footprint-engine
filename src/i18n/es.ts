export const es = {
  MISSING_XDR: "Campo requerido faltante: xdr",
  UNSUPPORTED_ENVELOPE_TYPE: "Tipo de envolvente de transacción no compatible",
  INVALID_NETWORK: "Red inválida. Use 'testnet', 'mainnet' o 'futurenet'",
  RPC_URL_NOT_CONFIGURED: "URL de RPC no configurada para la red",
  LEDGER_ENTRY_RESTORATION_REQUIRED:
    "La transacción requiere restauración de entradas del ledger antes de la simulación.",
  TRANSACTION_DATA_MISSING:
    "La simulación fue exitosa pero falta transactionData; no se puede extraer el footprint.",
  UNEXPECTED_ERROR: "Error inesperado",
  INTERNAL_SERVER_ERROR: "Error interno del servidor",
  BAD_REQUEST: "Solicitud incorrecta",
  UNPROCESSABLE_ENTITY: "Entidad no procesable",
  FORBIDDEN: "Acceso prohibido",
  RATE_LIMIT_EXCEEDED:
    "Demasiadas solicitudes. Por favor, inténtelo de nuevo más tarde.",
  REQUEST_TIMEOUT: "La solicitud ha expirado",
  REQUEST_TIMED_OUT: "La solicitud ha expirado",
  CONTENT_TYPE_INVALID: "Content-Type debe ser application/json",
  OPENAPI_SPEC_NOT_FOUND: "Especificación OpenAPI no encontrada",
  INVALID_XDR: "XDR inválido",
  INVALID_XDR_TYPE: "Tipo de XDR inválido",
  MISSING_REQUIRED_FIELDS: "Faltan campos requeridos",
  INVALID_QUERY_PARAMETERS: "Parámetros de consulta inválidos",
  INVALID_LEDGER_SEQUENCE: "ledgerSequence debe ser un entero positivo",
  BATCH_SIZE_EXCEEDED: "El tamaño del lote superó el límite máximo permitido",
  TRANSACTION_MISSING_SOROBAN_OPERATION:
    "La transacción debe contener una operación Soroban (invokeHostFunction).",
  RPC_SIMULATION_ERROR: "La simulación de la transacción falló",
  SIMULATION_RESTORE_REQUIRED:
    "La simulación requiere restauración de entradas del ledger",
  SIMULATION_DATA_MISSING: "Faltan datos de simulación",
  RESOURCE_LIMIT_EXCEEDED: "Se superó el límite de recursos de Soroban",
  CIRCUIT_OPEN:
    "Servicio temporalmente no disponible. Por favor, reintente más tarde.",
  JOB_NOT_FOUND: "Trabajo de webhook no encontrado",
  UNAUTHORIZED: "No autorizado",
} as const;
