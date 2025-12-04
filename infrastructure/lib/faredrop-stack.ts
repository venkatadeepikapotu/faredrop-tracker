// infrastructure/lib/faredrop-stack.ts
// Production-grade serverless architecture for flight price monitoring (CDK v2)

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as iam from 'aws-cdk-lib/aws-iam';  // ✅ ADDED
import * as dotenv from 'dotenv';

dotenv.config();

export class FareDropStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const removalPolicy = cdk.RemovalPolicy.DESTROY;

    // ===========================================
    // DynamoDB Tables
    // ===========================================

    const watchesTable = new dynamodb.Table(this, 'WatchesTable', {
      tableName: 'faredrop-watches',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'watchId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecovery: false,
    });

    watchesTable.addGlobalSecondaryIndex({
      indexName: 'active-watches-index',
      partitionKey: { name: 'isActive', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'updatedAt', type: dynamodb.AttributeType.STRING },
    });

    const priceSnapshotsTable = new dynamodb.Table(this, 'PriceSnapshotsTable', {
      tableName: 'faredrop-price-snapshots',
      partitionKey: { name: 'watchId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'timestamp', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy,
      pointInTimeRecovery: false,
      timeToLiveAttribute: 'ttl',
    });

    // ===========================================
    // Cognito User Pool + Google OAuth
    // ===========================================

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'faredrop-users',
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: false,
        requireUppercase: false,
        requireDigits: false,
        requireSymbols: false,
      },
      removalPolicy,
    });

    const googleProvider = new cognito.UserPoolIdentityProviderGoogle(this, 'GoogleProvider', {
      userPool,
      clientId: process.env.GOOGLE_CLIENT_ID || 'placeholder',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET || 'placeholder',
      scopes: ['email', 'profile', 'openid'],
      attributeMapping: {
        email: cognito.ProviderAttribute.GOOGLE_EMAIL,
      },
    });

    const userPoolClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      generateSecret: false,
      authFlows: { userSrp: true },
      supportedIdentityProviders: [
        cognito.UserPoolClientIdentityProvider.GOOGLE,
        cognito.UserPoolClientIdentityProvider.COGNITO,
      ],
      oAuth: {
        flows: { authorizationCodeGrant: true },
        scopes: [cognito.OAuthScope.EMAIL, cognito.OAuthScope.OPENID, cognito.OAuthScope.PROFILE],
        callbackUrls: ['http://localhost:3000/auth/callback'],
        logoutUrls: ['http://localhost:3000/auth/logout'],
      },
    });
    userPoolClient.node.addDependency(googleProvider);

    new cognito.UserPoolDomain(this, 'UserPoolDomain', {
      userPool,
      cognitoDomain: { domainPrefix: 'faredrop-auth' },
    });

    // ===========================================
    // Lambda Functions (Using NodejsFunction for TypeScript)
    // ===========================================

    const commonEnv = {
      WATCHES_TABLE: watchesTable.tableName,
      PRICE_SNAPSHOTS_TABLE: priceSnapshotsTable.tableName,
      AMADEUS_CLIENT_ID: process.env.AMADEUS_CLIENT_ID || '',
      AMADEUS_CLIENT_SECRET: process.env.AMADEUS_CLIENT_SECRET || '',
      VERIFIED_EMAIL: 'vpotu@ufl.edu',  // ✅ ADDED
      SES_REGION: 'us-east-1',          // ✅ ADDED
    };

    const watchManagement = new NodejsFunction(this, 'WatchManagementFunction', {
      functionName: 'faredrop-watch-management',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: '../lambda/watch-management/index.ts',
      environment: commonEnv,
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      logRetention: logs.RetentionDays.THREE_DAYS,
      bundling: {
        minify: false,
        sourceMap: true,
        forceDockerBundling: false
      },
    });

    const pricePoller = new NodejsFunction(this, 'PricePollerFunction', {
      functionName: 'faredrop-price-poller',
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'handler',
      entry: '../lambda/price-poller/index.ts',
      environment: commonEnv,
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      logRetention: logs.RetentionDays.THREE_DAYS,
      bundling: {
        minify: false,
        sourceMap: true,
        forceDockerBundling: false
      },
    });

    watchesTable.grantReadWriteData(watchManagement);
    priceSnapshotsTable.grantReadData(watchManagement);
    watchesTable.grantReadWriteData(pricePoller);
    priceSnapshotsTable.grantReadWriteData(pricePoller);

    // ✅ ADDED - SES Permissions for Price Poller
    pricePoller.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*']
    }));

    // ===========================================
    // API Gateway with CORS + Cognito Authorizer
    // ===========================================

    const api = new apigateway.RestApi(this, 'FareDropApi', {
      restApiName: 'faredrop-api',
      description: 'FareDrop Tracker REST API',
      endpointTypes: [apigateway.EndpointType.REGIONAL],
      deployOptions: {
        stageName: 'v1',
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200,
      },
    });

    const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'ApiAuthorizer', {
      cognitoUserPools: [userPool],
      authorizerName: 'CognitoAuthorizer',
    });

    // Mock integration for OPTIONS (returns 200, no auth, no Lambda)
    const optionsMockIntegration = new apigateway.MockIntegration({
      integrationResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': "'Content-Type,Authorization,X-Amz-Date,X-Api-Key,X-Amz-Security-Token,X-Amz-User-Agent'",
            'method.response.header.Access-Control-Allow-Methods': "'GET,POST,PUT,PATCH,DELETE,OPTIONS'",
            'method.response.header.Access-Control-Allow-Origin': "'http://localhost:3000'",
            'method.response.header.Access-Control-Allow-Credentials': "'true'",
          },
        },
      ],
      passthroughBehavior: apigateway.PassthroughBehavior.NEVER,
      requestTemplates: {
        'application/json': '{"statusCode": 200}',
      },
    });

    const watchIntegration = new apigateway.LambdaIntegration(watchManagement, {
      proxy: true,
    });

    // Remove v1 resource - stage name already provides versioning
    const watches = api.root.addResource('watches');

    // ===========================================
    // /watches Resource Methods
    // ===========================================

    // OPTIONS /watches (no auth)
    watches.addMethod('OPTIONS', optionsMockIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        },
      ],
    });

    // GET /watches (with auth)
    watches.addMethod('GET', watchIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // POST /watches (with auth)
    watches.addMethod('POST', watchIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });
    

    // ===========================================
    // /watches/{watchId} Resource Methods
    // ===========================================

    const watchId = watches.addResource('{watchId}');

    // OPTIONS /watches/{watchId} (no auth)
    watchId.addMethod('OPTIONS', optionsMockIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        },
      ],
    });

    // GET /watches/{watchId} (with auth)
    watchId.addMethod('GET', watchIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // PATCH /watches/{watchId} (with auth)
    watchId.addMethod('PATCH', watchIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // PUT /watches/{watchId} (with auth) - ✅ ADD THIS
    watchId.addMethod('PUT', watchIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // DELETE /watches/{watchId} (with auth)
    watchId.addMethod('DELETE', watchIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // After DELETE method, ADD THIS ENTIRE SECTION:

    // ===========================================
    // /watches/{watchId}/history Resource
    // ===========================================

    const history = watchId.addResource('history');

    // OPTIONS /watches/{watchId}/history (no auth)
    history.addMethod('OPTIONS', optionsMockIntegration, {
      methodResponses: [
        {
          statusCode: '200',
          responseParameters: {
            'method.response.header.Access-Control-Allow-Headers': true,
            'method.response.header.Access-Control-Allow-Methods': true,
            'method.response.header.Access-Control-Allow-Origin': true,
            'method.response.header.Access-Control-Allow-Credentials': true,
          },
        },
      ],
    });

    // GET /watches/{watchId}/history (with auth)
    history.addMethod('GET', watchIntegration, {
      authorizer,
      authorizationType: apigateway.AuthorizationType.COGNITO,
    });

    // ===========================================
    // EventBridge Scheduler
    // ===========================================

    const rule = new events.Rule(this, 'PricePollingSchedule', {
      schedule: events.Schedule.rate(cdk.Duration.hours(6)),
      description: 'Scheduled price polling for active watches',
    });
    rule.addTarget(new targets.LambdaFunction(pricePoller));

    // ===========================================
    // Outputs
    // ===========================================

    new cdk.CfnOutput(this, 'UserPoolId', {
      value: userPool.userPoolId,
      description: 'Cognito User Pool ID',
    });

    new cdk.CfnOutput(this, 'UserPoolClientId', {
      value: userPoolClient.userPoolClientId,
      description: 'Cognito User Pool Client ID',
    });

    new cdk.CfnOutput(this, 'ApiUrl', {
      value: api.url,
      description: 'API Gateway URL',
    });

    new cdk.CfnOutput(this, 'CognitoDomain', {
      value: 'faredrop-auth.auth.us-east-1.amazoncognito.com',
      description: 'Cognito Hosted UI Domain',
    });

    // infrastructure/lib/faredrop-stack.ts
  }
}