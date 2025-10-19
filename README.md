#  FareDrop Tracker

A serverless flight price monitoring system built on AWS that tracks flight prices and alerts users when prices drop below their target threshold.

**Tech Stack:** AWS Cloud | TypeScript | Next.js 14 | 100% Serverless
---

##  Table of Contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Prerequisites](#prerequisites)
- [Getting Started](#getting-started)
- [Project Structure](#project-structure)
- [Deployment](#deployment)
- [Usage](#usage)
- [Development](#development)
- [Environment Variables](#environment-variables)
- [Cost Estimation](#cost-estimation)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)
- [License](#license)

---

##  Features

- **Real-time Price Monitoring** - Automated price checks every 6 hours via AWS EventBridge
- **Smart Alerts** - Get notified when flight prices drop below your threshold
- **Google OAuth** - Secure authentication with Google Sign-In via AWS Cognito
- **Historical Tracking** - Store and analyze price trends over time
- **Serverless Architecture** - Zero server maintenance, automatic scaling, pay-per-use pricing
- **Modern UI** - Responsive React dashboard built with Next.js 14
- **Infrastructure as Code** - Complete AWS CDK implementation for reproducible deployments

---

##  Architecture
```
┌─────────────┐
│   User      │
│  (Browser)  │
└──────┬──────┘
       │
       ▼
┌─────────────────┐         ┌──────────────┐
│  Next.js 14     │────────▶│  Cognito     │
│  Frontend       │         │  (Google     │
└────────┬────────┘         │   OAuth)     │
         │                  └──────────────┘
         ▼
┌─────────────────┐
│  API Gateway    │
│  (REST API)     │
└────────┬────────┘
         │
         ▼
┌─────────────────┐         ┌──────────────┐
│  Lambda         │────────▶│  DynamoDB    │
│  (watch-mgmt)   │         │  - Watches   │
└─────────────────┘         │  - Snapshots │
         ▲                  └──────────────┘
         │
┌─────────────────┐
│  EventBridge    │
│  (6hr schedule) │
└────────┬────────┘
         │
         ▼
┌─────────────────┐         ┌──────────────┐
│  Lambda         │────────▶│  Amadeus     │
│  (price-poller) │         │  Flight API  │
└─────────────────┘         └──────────────┘
```

**Data Flow:**
1. User authenticates via Google OAuth (Cognito)
2. Creates price watches through Next.js frontend
3. API Gateway routes requests to Lambda functions
4. Lambda stores watches in DynamoDB
5. EventBridge triggers price-poller every 6 hours
6. Price-poller fetches current prices from Amadeus API
7. System stores snapshots and checks for price drops
8. Alerts triggered when prices fall below threshold

---

##  Tech Stack

### **Frontend**
- **Framework**: Next.js 14 (React 18)
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Authentication**: AWS Amplify Auth
- **HTTP Client**: Fetch API

### **Backend**
- **Compute**: AWS Lambda (Node.js 18)
- **API**: API Gateway (REST)
- **Database**: DynamoDB (NoSQL)
- **Scheduling**: EventBridge
- **Authentication**: Cognito User Pools
- **Language**: TypeScript

### **Infrastructure**
- **IaC**: AWS CDK (TypeScript)
- **Bundler**: esbuild
- **Deployment**: AWS CloudFormation

### **External Services**
- **Flight Data**: Amadeus Flight Search API
- **OAuth**: Google Cloud Platform

---

##  Prerequisites

Before you begin, ensure you have:

- **Node.js**: v18.x or higher ([Download](https://nodejs.org/))
- **npm**: v8.x or higher (comes with Node.js)
- **AWS CLI**: Configured with credentials ([Install Guide](https://aws.amazon.com/cli/))
- **AWS Account**: With appropriate permissions
- **Google Cloud Account**: For OAuth setup
- **Amadeus Developer Account**: For flight data API

### **Verify Prerequisites**
```bash
# Check Node.js version
node --version  # Should be v18.x or higher

# Check npm version
npm --version   # Should be v8.x or higher

# Check AWS CLI
aws --version
aws sts get-caller-identity  # Should return your AWS account info
```

---

##  Getting Started

### **1. Clone the Repository**
```bash
git clone https://github.com/your-username/faredrop-tracker.git
cd faredrop-tracker
```

### **2. Install Dependencies**
```bash
# Infrastructure dependencies
cd infrastructure
npm install

# Frontend dependencies
cd ../frontend
npm install

# Lambda dependencies
cd ../lambda/watch-management
npm install

cd ../price-poller
npm install
```

### **3. Configure Environment Variables**

#### **Get Required Credentials:**

1. **Google OAuth**:
   - Go to [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - Create OAuth 2.0 Client ID
   - Add authorized redirect URI: `https://your-cognito-domain/oauth2/idpresponse`
   - Copy Client ID and Client Secret

2. **Amadeus API**:
   - Sign up at [Amadeus for Developers](https://developers.amadeus.com/)
   - Create a new app
   - Copy API Key and API Secret

#### **Create Environment Files:**
```bash
# Copy templates
cp infrastructure/.env.example infrastructure/.env
cp frontend/.env.example frontend/.env.local

# Edit with your credentials
# infrastructure/.env
nano infrastructure/.env
```

**Add to `infrastructure/.env`:**
```env
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-your-secret
AMADEUS_CLIENT_ID=your-amadeus-key
AMADEUS_CLIENT_SECRET=your-amadeus-secret
```

### **4. Deploy Infrastructure**
```bash
cd infrastructure

# Build TypeScript
npm run build

# Bootstrap CDK (first time only)
npx cdk bootstrap

# Deploy to AWS
npx cdk deploy --require-approval never
```

**Copy the outputs** (UserPoolId, ClientId, ApiUrl, etc.)

### **5. Configure Frontend**

**Edit `frontend/.env.local` with values from CDK outputs:**
```env
NEXT_PUBLIC_API_URL=https://xxxxx.execute-api.us-east-1.amazonaws.com/v1
NEXT_PUBLIC_USER_POOL_ID=us-east-1_XXXXXXXXX
NEXT_PUBLIC_USER_POOL_CLIENT_ID=your-client-id
NEXT_PUBLIC_COGNITO_DOMAIN=faredrop-auth.auth.us-east-1.amazoncognito.com
NEXT_PUBLIC_COGNITO_REGION=us-east-1
```

### **6. Start Development Server**
```bash
cd frontend
npm run dev
```

**Open [http://localhost:3000](http://localhost:3000)**

---

##  Project Structure
```
faredrop-tracker/
├── infrastructure/              # AWS CDK Infrastructure
│   ├── bin/
│   │   └── faredrop.ts         # CDK app entry point
│   ├── lib/
│   │   └── faredrop-stack.ts   # Stack definition
│   ├── .env.example            # Environment template
│   ├── cdk.json                # CDK configuration
│   ├── package.json
│   └── tsconfig.json
│
├── lambda/                      # Lambda Functions
│   ├── watch-management/       # API endpoints
│   │   ├── index.ts           # CRUD operations
│   │   └── package.json
│   └── price-poller/          # Scheduled price checks
│       ├── index.ts           # Price fetching logic
│       └── package.json
│
├── frontend/                    # Next.js Application
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx       # Landing page
│   │   │   ├── dashboard/     # Dashboard UI
│   │   │   └── auth/          # Auth callbacks
│   │   └── lib/
│   │       ├── api.ts         # API client
│   │       └── amplify.ts     # Auth configuration
│   ├── public/
│   ├── .env.example
│   ├── package.json
│   └── next.config.js
│
├── .gitignore
├── README.md
└── LICENSE
```

---

##  Deployment

### **Development Deployment**
```bash
# Deploy infrastructure
cd infrastructure
npm run build
npx cdk deploy

# Start frontend locally
cd ../frontend
npm run dev
```

### **Production Deployment**

#### **Backend (AWS)**
Already deployed via CDK!

#### **Frontend Options:**

**Option 1: Vercel (Recommended)**
```bash
cd frontend
npx vercel

# Update callback URLs in Cognito to include your Vercel domain
```

**Option 2: AWS Amplify Hosting**
```bash
# Push to GitHub
git push origin main

# Connect repository in AWS Amplify Console
# https://console.aws.amazon.com/amplify/
```

**Option 3: Self-Hosted**
```bash
cd frontend
npm run build
npm start
```

---

##  Usage

### **Creating a Watch**

1. Sign in with Google
2. Click "**+ Create Watch**"
3. Enter flight details:
   - **Origin**: JFK (airport code)
   - **Destination**: LAX
   - **Date**: 2026-03-15
   - **Price Threshold**: $150
4. Click "**Create Watch**"

### **Monitoring Prices**

- System automatically checks prices **every 6 hours**
- View current prices on dashboard
- Price history stored for 7 days
- Alerts triggered when price drops below threshold

### **Managing Watches**

- **View**: All watches displayed on dashboard
- **Update**: Click watch to modify threshold
- **Delete**: Remove watches no longer needed
- **Status**: Active/inactive toggle

---

##  Development

### **Local Development**
```bash
# Terminal 1: Frontend
cd frontend
npm run dev

# Terminal 2: Watch Lambda logs (optional)
aws logs tail /aws/lambda/faredrop-watch-management --follow

# Terminal 3: Watch price-poller logs (optional)
aws logs tail /aws/lambda/faredrop-price-poller --follow
```

### **Testing Changes**
```bash
# Build TypeScript
cd infrastructure
npm run build

# Deploy changes
npx cdk deploy

# Or deploy specific changes
npx cdk diff  # Preview changes
npx cdk deploy --hotswap  # Fast deploy for Lambda code changes
```

### **Useful Commands**
```bash
# CDK Commands
npx cdk synth           # Synthesize CloudFormation template
npx cdk diff            # Compare deployed stack with current state
npx cdk destroy         # Delete stack and all resources

# Lambda Logs
aws logs tail /aws/lambda/faredrop-watch-management --since 5m
aws logs tail /aws/lambda/faredrop-price-poller --since 1h

# DynamoDB
aws dynamodb scan --table-name faredrop-watches
aws dynamodb scan --table-name faredrop-price-snapshots

# API Gateway
aws apigateway get-rest-apis
aws apigateway test-invoke-method --rest-api-id {id} --resource-id {id} --http-method GET
```

---

##  Environment Variables

### **Infrastructure (`infrastructure/.env`)**

| Variable | Description | Example |
|----------|-------------|---------|
| `GOOGLE_CLIENT_ID` | Google OAuth Client ID | `123...apps.googleusercontent.com` |
| `GOOGLE_CLIENT_SECRET` | Google OAuth Secret | `GOCSPX-...` |
| `AMADEUS_CLIENT_ID` | Amadeus API Key | `abc123...` |
| `AMADEUS_CLIENT_SECRET` | Amadeus API Secret | `xyz789...` |

### **Frontend (`frontend/.env.local`)**

| Variable | Description | Example |
|----------|-------------|---------|
| `NEXT_PUBLIC_API_URL` | API Gateway endpoint | `https://xxx.execute-api.us-east-1.amazonaws.com/v1` |
| `NEXT_PUBLIC_USER_POOL_ID` | Cognito User Pool ID | `us-east-1_XXXXXXXXX` |
| `NEXT_PUBLIC_USER_POOL_CLIENT_ID` | Cognito Client ID | `1a2b3c...` |
| `NEXT_PUBLIC_COGNITO_DOMAIN` | Cognito hosted UI domain | `faredrop-auth.auth.us-east-1.amazoncognito.com` |
| `NEXT_PUBLIC_COGNITO_REGION` | AWS Region | `us-east-1` |

---

##  Cost Estimation

**Monthly costs for moderate usage (100 active users, 500 watches):**

| Service | Usage | Monthly Cost |
|---------|-------|--------------|
| **Lambda** | ~50K invocations | $0.10 |
| **API Gateway** | ~100K requests | $0.35 |
| **DynamoDB** | 10GB storage, on-demand | $2.50 |
| **EventBridge** | 720 events/month | $0.01 |
| **Cognito** | 100 MAUs | Free (< 50K) |
| **CloudWatch Logs** | 1GB logs | $0.50 |
| **Total** | | **~$3.50/month** |

**At scale (1,000 users, 5,000 watches):**
- Estimated: **$15-25/month**

**Note**: Amadeus API costs depend on your plan (test environment is free with limits).

---

##  Troubleshooting

### **CORS Errors**
```
Access to fetch has been blocked by CORS policy
```

**Solution**: Verify `frontend/.env.local` has correct API URL and matches deployed API Gateway.

### **401 Unauthorized**
```
API Error: 401
```

**Solution**: 
1. Check Cognito configuration in frontend
2. Verify JWT token is being sent: `Authorization: Bearer <token>`
3. Check Lambda logs for auth errors

### **502 Bad Gateway**
```
API Error: 502
```

**Solution**:
1. Check Lambda logs: `aws logs tail /aws/lambda/faredrop-watch-management --since 5m`
2. Verify Lambda has correct environment variables
3. Check DynamoDB permissions

### **Deployment Fails**
```
Error: Docker not found
```

**Solution**: Add `forceDockerBundling: false` to Lambda functions in `faredrop-stack.ts`

### **Check Lambda Logs**
```bash
# Recent errors
aws logs tail /aws/lambda/faredrop-watch-management --since 10m | Select-String "ERROR"

# Specific error
aws logs filter-log-events --log-group-name /aws/lambda/faredrop-watch-management --filter-pattern "ERROR"
```

---

##  Contributing

Contributions are welcome! Please follow these steps:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feature/amazing-feature`)
3. **Commit** your changes (`git commit -m 'Add amazing feature'`)
4. **Push** to the branch (`git push origin feature/amazing-feature`)
5. **Open** a Pull Request

### **Development Guidelines**

- Follow TypeScript best practices
- Add tests for new features
- Update documentation
- Ensure all tests pass
- Follow existing code style


---

##  Authors

**Venkata Deepika Potu** - *Initial work* - [GitHub](https://github.com/venkatadeepikapotu)

---

## Acknowledgments

- **AWS** for serverless infrastructure
- **Amadeus** for flight data API
- **Next.js** team for the amazing framework
- **AWS CDK** for Infrastructure as Code
- **AMEX WiCSE Program** for project support

---

## Support

For questions or issues:
- **GitHub Issues**: [Create an issue](https://github.com/venkatadeepikapotu/faredrop-tracker/issues)
- **Email**: deepikapotu03@gmail.com
