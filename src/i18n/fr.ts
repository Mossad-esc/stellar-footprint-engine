export const fr = {
  MISSING_XDR: "Champ requis manquant : xdr",
  UNSUPPORTED_ENVELOPE_TYPE: "Type d'enveloppe de transaction non pris en charge",
  INVALID_NETWORK:
    "Réseau invalide. Utilisez 'testnet', 'mainnet' ou 'futurenet'",
  RPC_URL_NOT_CONFIGURED: "URL RPC non configurée pour le réseau",
  LEDGER_ENTRY_RESTORATION_REQUIRED:
    "La transaction nécessite la restauration d'entrées du registre avant la simulation.",
  TRANSACTION_DATA_MISSING:
    "La simulation a réussi mais transactionData est manquant ; impossible d'extraire le footprint.",
  UNEXPECTED_ERROR: "Erreur inattendue",
  INTERNAL_SERVER_ERROR: "Erreur interne du serveur",
  BAD_REQUEST: "Requête invalide",
  UNPROCESSABLE_ENTITY: "Entité non traitable",
  FORBIDDEN: "Accès interdit",
  RATE_LIMIT_EXCEEDED:
    "Trop de requêtes. Veuillez réessayer plus tard.",
  REQUEST_TIMEOUT: "La requête a expiré",
  REQUEST_TIMED_OUT: "La requête a expiré",
  CONTENT_TYPE_INVALID: "Content-Type doit être application/json",
  OPENAPI_SPEC_NOT_FOUND: "Spécification OpenAPI introuvable",
  INVALID_XDR: "XDR invalide",
  INVALID_XDR_TYPE: "Type de XDR invalide",
  MISSING_REQUIRED_FIELDS: "Champs requis manquants",
  INVALID_QUERY_PARAMETERS: "Paramètres de requête invalides",
  INVALID_LEDGER_SEQUENCE: "ledgerSequence doit être un entier positif",
  BATCH_SIZE_EXCEEDED:
    "La taille du lot a dépassé la limite maximale autorisée",
  TRANSACTION_MISSING_SOROBAN_OPERATION:
    "La transaction doit contenir une opération Soroban (invokeHostFunction).",
  RPC_SIMULATION_ERROR: "La simulation de la transaction a échoué",
  SIMULATION_RESTORE_REQUIRED:
    "La simulation nécessite la restauration d'entrées du registre",
  SIMULATION_DATA_MISSING: "Les données de simulation sont manquantes",
  RESOURCE_LIMIT_EXCEEDED: "Limite de ressources Soroban dépassée",
  CIRCUIT_OPEN:
    "Service temporairement indisponible. Veuillez réessayer plus tard.",
  JOB_NOT_FOUND: "Tâche webhook introuvable",
  UNAUTHORIZED: "Non autorisé",
} as const;
