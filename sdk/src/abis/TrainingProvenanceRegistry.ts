// GENERATED FILE — do not hand-edit. Source of truth: contracts/artifacts/src/TrainingProvenanceRegistry.sol/TrainingProvenanceRegistry.json (Hardhat's own compiled output).
// Regenerate with `npm run generate-abis` after any contract change — see ADR 0012.

export const TRAINING_PROVENANCE_REGISTRY_ABI = [
  {
    "inputs": [
      {
        "internalType": "address",
        "name": "cascadeRegistryAddress",
        "type": "address"
      },
      {
        "internalType": "address",
        "name": "executionRegistryAddress",
        "type": "address"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "constructor"
  },
  {
    "inputs": [],
    "name": "BaseModelCommitmentMismatch",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ECDSAInvalidSignature",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "uint256",
        "name": "length",
        "type": "uint256"
      }
    ],
    "name": "ECDSAInvalidSignatureLength",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "s",
        "type": "bytes32"
      }
    ],
    "name": "ECDSAInvalidSignatureS",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "InvalidShortString",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "NotModelOwner",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProvenanceAlreadyRegistered",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ProvenanceNotFound",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ResultCommitmentMismatch",
    "type": "error"
  },
  {
    "inputs": [
      {
        "internalType": "string",
        "name": "str",
        "type": "string"
      }
    ],
    "name": "StringTooLong",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "UnregisteredProvider",
    "type": "error"
  },
  {
    "inputs": [],
    "name": "ZeroAddress",
    "type": "error"
  },
  {
    "anonymous": false,
    "inputs": [],
    "name": "EIP712DomainChanged",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "childModelId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "bytes32",
        "name": "baseModelId",
        "type": "bytes32"
      },
      {
        "indexed": true,
        "internalType": "address",
        "name": "provider",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "address",
        "name": "registrant",
        "type": "address"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "commitment",
        "type": "bytes32"
      },
      {
        "indexed": false,
        "internalType": "bytes32",
        "name": "taskId",
        "type": "bytes32"
      }
    ],
    "name": "ProvenanceRegistered",
    "type": "event"
  },
  {
    "inputs": [],
    "name": "TRAINING_PROVENANCE_CLAIM_TYPEHASH",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "cascadeRegistry",
    "outputs": [
      {
        "internalType": "contract CascadeRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "eip712Domain",
    "outputs": [
      {
        "internalType": "bytes1",
        "name": "fields",
        "type": "bytes1"
      },
      {
        "internalType": "string",
        "name": "name",
        "type": "string"
      },
      {
        "internalType": "string",
        "name": "version",
        "type": "string"
      },
      {
        "internalType": "uint256",
        "name": "chainId",
        "type": "uint256"
      },
      {
        "internalType": "address",
        "name": "verifyingContract",
        "type": "address"
      },
      {
        "internalType": "bytes32",
        "name": "salt",
        "type": "bytes32"
      },
      {
        "internalType": "uint256[]",
        "name": "extensions",
        "type": "uint256[]"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "childModelId",
        "type": "bytes32"
      }
    ],
    "name": "evidenceHashOf",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [],
    "name": "executionRegistry",
    "outputs": [
      {
        "internalType": "contract ExecutionRegistry",
        "name": "",
        "type": "address"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "childModelId",
        "type": "bytes32"
      }
    ],
    "name": "getProvenance",
    "outputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "baseModelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "baseModelHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "datasetRootHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "scriptHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "resultRootHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "taskId",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "evidenceURI",
            "type": "string"
          },
          {
            "internalType": "address",
            "name": "provider",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "registrant",
            "type": "address"
          },
          {
            "internalType": "uint64",
            "name": "issuedAt",
            "type": "uint64"
          },
          {
            "internalType": "uint64",
            "name": "registeredAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TrainingProvenanceRegistry.TrainingProvenance",
        "name": "",
        "type": "tuple"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "childModelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "baseModelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "baseModelHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "datasetRootHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "scriptHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "resultRootHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "taskId",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "evidenceURI",
            "type": "string"
          },
          {
            "internalType": "uint64",
            "name": "issuedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TrainingProvenanceRegistry.TrainingProvenanceClaim",
        "name": "claim",
        "type": "tuple"
      }
    ],
    "name": "hashClaim",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "pure",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "childModelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "baseModelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "baseModelHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "datasetRootHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "scriptHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "resultRootHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "taskId",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "evidenceURI",
            "type": "string"
          },
          {
            "internalType": "uint64",
            "name": "issuedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TrainingProvenanceRegistry.TrainingProvenanceClaim",
        "name": "claim",
        "type": "tuple"
      }
    ],
    "name": "hashTypedDataDigest",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "childModelId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "expectedBaseModelId",
        "type": "bytes32"
      },
      {
        "internalType": "bytes32",
        "name": "expectedEvidenceHash",
        "type": "bytes32"
      }
    ],
    "name": "matchesEdge",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "internalType": "bytes32",
        "name": "",
        "type": "bytes32"
      }
    ],
    "name": "provenanceExists",
    "outputs": [
      {
        "internalType": "bool",
        "name": "",
        "type": "bool"
      }
    ],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          {
            "internalType": "bytes32",
            "name": "childModelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "baseModelId",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "baseModelHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "datasetRootHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "scriptHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "resultRootHash",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "taskId",
            "type": "bytes32"
          },
          {
            "internalType": "string",
            "name": "evidenceURI",
            "type": "string"
          },
          {
            "internalType": "uint64",
            "name": "issuedAt",
            "type": "uint64"
          }
        ],
        "internalType": "struct TrainingProvenanceRegistry.TrainingProvenanceClaim",
        "name": "claim",
        "type": "tuple"
      },
      {
        "internalType": "bytes",
        "name": "signature",
        "type": "bytes"
      }
    ],
    "name": "registerProvenance",
    "outputs": [
      {
        "internalType": "bytes32",
        "name": "commitment",
        "type": "bytes32"
      }
    ],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;
