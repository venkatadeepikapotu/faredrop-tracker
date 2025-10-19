"use strict";
// infrastructure/lib/faredrop-stack.ts
// Production-grade serverless architecture for flight price monitoring (CDK v2)
Object.defineProperty(exports, "__esModule", { value: true });
exports.FareDropStack = void 0;
const cdk = require("aws-cdk-lib");
const cognito = require("aws-cdk-lib/aws-cognito");
const apigateway = require("aws-cdk-lib/aws-apigateway");
const lambda = require("aws-cdk-lib/aws-lambda");
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const dynamodb = require("aws-cdk-lib/aws-dynamodb");
const events = require("aws-cdk-lib/aws-events");
const targets = require("aws-cdk-lib/aws-events-targets");
const logs = require("aws-cdk-lib/aws-logs");
class FareDropStack extends cdk.Stack {
    constructor(scope, id, props) {
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
        };
        const watchManagement = new aws_lambda_nodejs_1.NodejsFunction(this, 'WatchManagementFunction', {
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
        const pricePoller = new aws_lambda_nodejs_1.NodejsFunction(this, 'PricePollerFunction', {
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
        // DELETE /watches/{watchId} (with auth)
        watchId.addMethod('DELETE', watchIntegration, {
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
    }
}
exports.FareDropStack = FareDropStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZmFyZWRyb3Atc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJmYXJlZHJvcC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiO0FBQUEsdUNBQXVDO0FBQ3ZDLGdGQUFnRjs7O0FBRWhGLG1DQUFtQztBQUVuQyxtREFBbUQ7QUFDbkQseURBQXlEO0FBQ3pELGlEQUFpRDtBQUNqRCxxRUFBK0Q7QUFDL0QscURBQXFEO0FBQ3JELGlEQUFpRDtBQUNqRCwwREFBMEQ7QUFDMUQsNkNBQTZDO0FBRTdDLE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzFDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxhQUFhLEdBQUcsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPLENBQUM7UUFFaEQsOENBQThDO1FBQzlDLGtCQUFrQjtRQUNsQiw4Q0FBOEM7UUFFOUMsTUFBTSxZQUFZLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDNUQsU0FBUyxFQUFFLGtCQUFrQjtZQUM3QixZQUFZLEVBQUUsRUFBRSxJQUFJLEVBQUUsUUFBUSxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNyRSxPQUFPLEVBQUUsRUFBRSxJQUFJLEVBQUUsU0FBUyxFQUFFLElBQUksRUFBRSxRQUFRLENBQUMsYUFBYSxDQUFDLE1BQU0sRUFBRTtZQUNqRSxXQUFXLEVBQUUsUUFBUSxDQUFDLFdBQVcsQ0FBQyxlQUFlO1lBQ2pELGFBQWE7WUFDYixtQkFBbUIsRUFBRSxLQUFLO1NBQzNCLENBQUMsQ0FBQztRQUVILFlBQVksQ0FBQyx1QkFBdUIsQ0FBQztZQUNuQyxTQUFTLEVBQUUsc0JBQXNCO1lBQ2pDLFlBQVksRUFBRSxFQUFFLElBQUksRUFBRSxVQUFVLEVB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Qiw4Q0FBOEM7UUFFOUMsTUFBTSxJQUFJLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxzQkFBc0IsRUFBRTtZQUN6RCxRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUMsR0FBRyxDQUFDLFFBQVEsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7WUFDckQsV0FBVyxFQUFFLDRDQUE0QztTQUMxRCxDQUFDLENBQUM7UUFDSCxJQUFJLENBQUMsU0FBUyxDQUFDLElBQUksT0FBTyxDQUFDLGNBQWMsQ0FBQyxXQUFXLENBQUMsQ0FBQyxDQUFDO1FBRXhELDhDQUE4QztRQUM5QyxVQUFVO1FBQ1YsOENBQThDO1FBRTlDLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsWUFBWSxFQUFFO1lBQ3BDLEtBQUssRUFBRSxRQUFRLENBQUMsVUFBVTtZQUMxQixXQUFXLEVBQUUsc0JBQXNCO1NBQ3BDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLGNBQWMsQ0FBQyxnQkFBZ0I7WUFDdEMsV0FBVyxFQUFFLDZCQUE2QjtTQUMzQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUNoQyxLQUFLLEVBQUUsR0FBRyxDQUFDLEdBQUc7WUFDZCxXQUFXLEVBQUUsaUJBQWlCO1NBQy9CLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3ZDLEtBQUssRUFBRSxnREFBZ0Q7WUFDdkQsV0FBVyxFQUFFLDBCQUEwQjtTQUN4QyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUE1UkQsc0NBNFJDIiwic291cmNlc0NvbnRlbnQiOlsiLy8gaW5mcmFzdHJ1Y3R1cmUvbGliL2ZhcmVkcm9wLXN0YWNrLnRzXHJcbi8vIFByb2R1Y3Rpb24tZ3JhZGUgc2VydmVybGVzcyBhcmNoaXRlY3R1cmUgZm9yIGZsaWdodCBwcmljZSBtb25pdG9yaW5nIChDREsgdjIpXHJcblxyXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xyXG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcclxuaW1wb3J0ICogYXMgY29nbml0byBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29nbml0byc7XHJcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xyXG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XHJcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnO1xyXG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xyXG5pbXBvcnQgKiBhcyBldmVudHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cyc7XHJcbmltcG9ydCAqIGFzIHRhcmdldHMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWV2ZW50cy10YXJnZXRzJztcclxuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XHJcblxyXG5leHBvcnQgY2xhc3MgRmFyZURyb3BTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XHJcbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM/OiBjZGsuU3RhY2tQcm9wcykge1xyXG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XHJcblxyXG4gICAgY29uc3QgcmVtb3ZhbFBvbGljeSA9IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1k7XHJcblxyXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gICAgLy8gRHluYW1vREIgVGFibGVzXHJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4gICAgY29uc3Qgd2F0Y2hlc1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdXYXRjaGVzVGFibGUnLCB7XHJcbiAgICAgIHRhYmxlTmFtZTogJ2ZhcmVkcm9wLXdhdGNoZXMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3VzZXJJZCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3dhdGNoSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5LFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiBmYWxzZSxcclxuICAgIH0pO1xyXG5cclxuICAgIHdhdGNoZXNUYWJsZS5hZGRHbG9iYWxTZWNvbmRhcnlJbmRleCh7XHJcbiAgICAgIGluZGV4TmFtZTogJ2FjdGl2ZS13YXRjaGVzLWluZGV4JyxcclxuICAgICAgcGFydGl0aW9uS2V5OiB7IG5hbWU6ICdpc0FjdGl2ZScsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICAgIHNvcnRLZXk6IHsgbmFtZTogJ3VwZGF0ZWRBdCcsIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBwcmljZVNuYXBzaG90c1RhYmxlID0gbmV3IGR5bmFtb2RiLlRhYmxlKHRoaXMsICdQcmljZVNuYXBzaG90c1RhYmxlJywge1xyXG4gICAgICB0YWJsZU5hbWU6ICdmYXJlZHJvcC1wcmljZS1zbmFwc2hvdHMnLFxyXG4gICAgICBwYXJ0aXRpb25LZXk6IHsgbmFtZTogJ3dhdGNoSWQnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBzb3J0S2V5OiB7IG5hbWU6ICd0aW1lc3RhbXAnLCB0eXBlOiBkeW5hbW9kYi5BdHRyaWJ1dGVUeXBlLlNUUklORyB9LFxyXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxyXG4gICAgICByZW1vdmFsUG9saWN5LFxyXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiBmYWxzZSxcclxuICAgICAgdGltZVRvTGl2ZUF0dHJpYnV0ZTogJ3R0bCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbiAgICAvLyBDb2duaXRvIFVzZXIgUG9vbCArIEdvb2dsZSBPQXV0aFxyXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuICAgIGNvbnN0IHVzZXJQb29sID0gbmV3IGNvZ25pdG8uVXNlclBvb2wodGhpcywgJ1VzZXJQb29sJywge1xyXG4gICAgICB1c2VyUG9vbE5hbWU6ICdmYXJlZHJvcC11c2VycycsXHJcbiAgICAgIHNlbGZTaWduVXBFbmFibGVkOiB0cnVlLFxyXG4gICAgICBzaWduSW5BbGlhc2VzOiB7IGVtYWlsOiB0cnVlIH0sXHJcbiAgICAgIGF1dG9WZXJpZnk6IHsgZW1haWw6IHRydWUgfSxcclxuICAgICAgcGFzc3dvcmRQb2xpY3k6IHtcclxuICAgICAgICBtaW5MZW5ndGg6IDgsXHJcbiAgICAgICAgcmVxdWlyZUxvd2VyY2FzZTogZmFsc2UsXHJcbiAgICAgICAgcmVxdWlyZVVwcGVyY2FzZTogZmFsc2UsXHJcbiAgICAgICAgcmVxdWlyZURpZ2l0czogZmFsc2UsXHJcbiAgICAgICAgcmVxdWlyZVN5bWJvbHM6IGZhbHNlLFxyXG4gICAgICB9LFxyXG4gICAgICByZW1vdmFsUG9saWN5LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgZ29vZ2xlUHJvdmlkZXIgPSBuZXcgY29nbml0by5Vc2VyUG9vbElkZW50aXR5UHJvdmlkZXJHb29nbGUodGhpcywgJ0dvb2dsZVByb3ZpZGVyJywge1xyXG4gICAgICB1c2VyUG9vbCxcclxuICAgICAgY2xpZW50SWQ6IHByb2Nlc3MuZW52LkdPT0dMRV9DTElFTlRfSUQgfHwgJ3BsYWNlaG9sZGVyJyxcclxuICAgICAgY2xpZW50U2VjcmV0OiBwcm9jZXNzLmVudi5HT09HTEVfQ0xJRU5UX1NFQ1JFVCB8fCAncGxhY2Vob2xkZXInLFxyXG4gICAgICBzY29wZXM6IFsnZW1haWwnLCAncHJvZmlsZScsICdvcGVuaWQnXSxcclxuICAgICAgYXR0cmlidXRlTWFwcGluZzoge1xyXG4gICAgICAgIGVtYWlsOiBjb2duaXRvLlByb3ZpZGVyQXR0cmlidXRlLkdPT0dMRV9FTUFJTCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHVzZXJQb29sQ2xpZW50ID0gbmV3IGNvZ25pdG8uVXNlclBvb2xDbGllbnQodGhpcywgJ1VzZXJQb29sQ2xpZW50Jywge1xyXG4gICAgICB1c2VyUG9vbCxcclxuICAgICAgZ2VuZXJhdGVTZWNyZXQ6IGZhbHNlLFxyXG4gICAgICBhdXRoRmxvd3M6IHsgdXNlclNycDogdHJ1ZSB9LFxyXG4gICAgICBzdXBwb3J0ZWRJZGVudGl0eVByb3ZpZGVyczogW1xyXG4gICAgICAgIGNvZ25pdG8uVXNlclBvb2xDbGllbnRJZGVudGl0eVByb3ZpZGVyLkdPT0dMRSxcclxuICAgICAgICBjb2duaXRvLlVzZXJQb29sQ2xpZW50SWRlbnRpdHlQcm92aWRlci5DT0dOSVRPLFxyXG4gICAgICBdLFxyXG4gICAgICBvQXV0aDoge1xyXG4gICAgICAgIGZsb3dzOiB7IGF1dGhvcml6YXRpb25Db2RlR3JhbnQ6IHRydWUgfSxcclxuICAgICAgICBzY29wZXM6IFtjb2duaXRvLk9BdXRoU2NvcGUuRU1BSUwsIGNvZ25pdG8uT0F1dGhTY29wZS5PUEVOSUQsIGNvZ25pdG8uT0F1dGhTY29wZS5QUk9GSUxFXSxcclxuICAgICAgICBjYWxsYmFja1VybHM6IFsnaHR0cDovL2xvY2FsaG9zdDozMDAwL2F1dGgvY2FsbGJhY2snXSxcclxuICAgICAgICBsb2dvdXRVcmxzOiBbJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMC9hdXRoL2xvZ291dCddLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICB1c2VyUG9vbENsaWVudC5ub2RlLmFkZERlcGVuZGVuY3koZ29vZ2xlUHJvdmlkZXIpO1xyXG5cclxuICAgIG5ldyBjb2duaXRvLlVzZXJQb29sRG9tYWluKHRoaXMsICdVc2VyUG9vbERvbWFpbicsIHtcclxuICAgICAgdXNlclBvb2wsXHJcbiAgICAgIGNvZ25pdG9Eb21haW46IHsgZG9tYWluUHJlZml4OiAnZmFyZWRyb3AtYXV0aCcgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuICAgIC8vIExhbWJkYSBGdW5jdGlvbnMgKFVzaW5nIE5vZGVqc0Z1bmN0aW9uIGZvciBUeXBlU2NyaXB0KVxyXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuICAgIGNvbnN0IGNvbW1vbkVudiA9IHtcclxuICAgICAgV0FUQ0hFU19UQUJMRTogd2F0Y2hlc1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgUFJJQ0VfU05BUFNIT1RTX1RBQkxFOiBwcmljZVNuYXBzaG90c1RhYmxlLnRhYmxlTmFtZSxcclxuICAgICAgQU1BREVVU19DTElFTlRfSUQ6IHByb2Nlc3MuZW52LkFNQURFVVNfQ0xJRU5UX0lEIHx8ICcnLFxyXG4gICAgICBBTUFERVVTX0NMSUVOVF9TRUNSRVQ6IHByb2Nlc3MuZW52LkFNQURFVVNfQ0xJRU5UX1NFQ1JFVCB8fCAnJyxcclxuICAgIH07XHJcblxyXG4gICAgY29uc3Qgd2F0Y2hNYW5hZ2VtZW50ID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsICdXYXRjaE1hbmFnZW1lbnRGdW5jdGlvbicsIHtcclxuICAgICAgZnVuY3Rpb25OYW1lOiAnZmFyZWRyb3Atd2F0Y2gtbWFuYWdlbWVudCcsXHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXHJcbiAgICAgIGVudHJ5OiAnLi4vbGFtYmRhL3dhdGNoLW1hbmFnZW1lbnQvaW5kZXgudHMnLFxyXG4gICAgICBlbnZpcm9ubWVudDogY29tbW9uRW52LFxyXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygxMCksXHJcbiAgICAgIG1lbW9yeVNpemU6IDI1NixcclxuICAgICAgbG9nUmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuVEhSRUVfREFZUyxcclxuICAgICAgYnVuZGxpbmc6IHtcclxuICAgICAgICBtaW5pZnk6IGZhbHNlLFxyXG4gICAgICAgIHNvdXJjZU1hcDogdHJ1ZSxcclxuICAgICAgICBmb3JjZURvY2tlckJ1bmRsaW5nOiBmYWxzZVxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgcHJpY2VQb2xsZXIgPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgJ1ByaWNlUG9sbGVyRnVuY3Rpb24nLCB7XHJcbiAgICAgIGZ1bmN0aW9uTmFtZTogJ2ZhcmVkcm9wLXByaWNlLXBvbGxlcicsXHJcbiAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU18xOF9YLFxyXG4gICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXHJcbiAgICAgIGVudHJ5OiAnLi4vbGFtYmRhL3ByaWNlLXBvbGxlci9pbmRleC50cycsXHJcbiAgICAgIGVudmlyb25tZW50OiBjb21tb25FbnYsXHJcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDIpLFxyXG4gICAgICBtZW1vcnlTaXplOiA1MTIsXHJcbiAgICAgIGxvZ1JldGVudGlvbjogbG9ncy5SZXRlbnRpb25EYXlzLlRIUkVFX0RBWVMsXHJcbiAgICAgIGJ1bmRsaW5nOiB7XHJcbiAgICAgICAgbWluaWZ5OiBmYWxzZSxcclxuICAgICAgICBzb3VyY2VNYXA6IHRydWUsXHJcbiAgICAgICAgZm9yY2VEb2NrZXJCdW5kbGluZzogZmFsc2VcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIHdhdGNoZXNUYWJsZS5ncmFudFJlYWRXcml0ZURhdGEod2F0Y2hNYW5hZ2VtZW50KTtcclxuICAgIHByaWNlU25hcHNob3RzVGFibGUuZ3JhbnRSZWFkRGF0YSh3YXRjaE1hbmFnZW1lbnQpO1xyXG4gICAgd2F0Y2hlc1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShwcmljZVBvbGxlcik7XHJcbiAgICBwcmljZVNuYXBzaG90c1RhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShwcmljZVBvbGxlcik7XHJcblxyXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gICAgLy8gQVBJIEdhdGV3YXkgd2l0aCBDT1JTICsgQ29nbml0byBBdXRob3JpemVyXHJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4gICAgY29uc3QgYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnRmFyZURyb3BBcGknLCB7XHJcbiAgICAgIHJlc3RBcGlOYW1lOiAnZmFyZWRyb3AtYXBpJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdGYXJlRHJvcCBUcmFja2VyIFJFU1QgQVBJJyxcclxuICAgICAgZW5kcG9pbnRUeXBlczogW2FwaWdhdGV3YXkuRW5kcG9pbnRUeXBlLlJFR0lPTkFMXSxcclxuICAgICAgZGVwbG95T3B0aW9uczoge1xyXG4gICAgICAgIHN0YWdlTmFtZTogJ3YxJyxcclxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiAxMDAsXHJcbiAgICAgICAgdGhyb3R0bGluZ0J1cnN0TGltaXQ6IDIwMCxcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGF1dGhvcml6ZXIgPSBuZXcgYXBpZ2F0ZXdheS5Db2duaXRvVXNlclBvb2xzQXV0aG9yaXplcih0aGlzLCAnQXBpQXV0aG9yaXplcicsIHtcclxuICAgICAgY29nbml0b1VzZXJQb29sczogW3VzZXJQb29sXSxcclxuICAgICAgYXV0aG9yaXplck5hbWU6ICdDb2duaXRvQXV0aG9yaXplcicsXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBNb2NrIGludGVncmF0aW9uIGZvciBPUFRJT05TIChyZXR1cm5zIDIwMCwgbm8gYXV0aCwgbm8gTGFtYmRhKVxyXG4gICAgY29uc3Qgb3B0aW9uc01vY2tJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5Lk1vY2tJbnRlZ3JhdGlvbih7XHJcbiAgICAgIGludGVncmF0aW9uUmVzcG9uc2VzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXHJcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcclxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6IFwiJ0NvbnRlbnQtVHlwZSxBdXRob3JpemF0aW9uLFgtQW16LURhdGUsWC1BcGktS2V5LFgtQW16LVNlY3VyaXR5LVRva2VuLFgtQW16LVVzZXItQWdlbnQnXCIsXHJcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiBcIidHRVQsUE9TVCxQVVQsUEFUQ0gsREVMRVRFLE9QVElPTlMnXCIsXHJcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IFwiJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMCdcIixcclxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctQ3JlZGVudGlhbHMnOiBcIid0cnVlJ1wiLFxyXG4gICAgICAgICAgfSxcclxuICAgICAgICB9LFxyXG4gICAgICBdLFxyXG4gICAgICBwYXNzdGhyb3VnaEJlaGF2aW9yOiBhcGlnYXRld2F5LlBhc3N0aHJvdWdoQmVoYXZpb3IuTkVWRVIsXHJcbiAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHtcclxuICAgICAgICAnYXBwbGljYXRpb24vanNvbic6ICd7XCJzdGF0dXNDb2RlXCI6IDIwMH0nLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgd2F0Y2hJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKHdhdGNoTWFuYWdlbWVudCwge1xyXG4gICAgICBwcm94eTogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFJlbW92ZSB2MSByZXNvdXJjZSAtIHN0YWdlIG5hbWUgYWxyZWFkeSBwcm92aWRlcyB2ZXJzaW9uaW5nXHJcbiAgICBjb25zdCB3YXRjaGVzID0gYXBpLnJvb3QuYWRkUmVzb3VyY2UoJ3dhdGNoZXMnKTtcclxuXHJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcbiAgICAvLyAvd2F0Y2hlcyBSZXNvdXJjZSBNZXRob2RzXHJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4gICAgLy8gT1BUSU9OUyAvd2F0Y2hlcyAobm8gYXV0aClcclxuICAgIHdhdGNoZXMuYWRkTWV0aG9kKCdPUFRJT05TJywgb3B0aW9uc01vY2tJbnRlZ3JhdGlvbiwge1xyXG4gICAgICBtZXRob2RSZXNwb25zZXM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICBzdGF0dXNDb2RlOiAnMjAwJyxcclxuICAgICAgICAgIHJlc3BvbnNlUGFyYW1ldGVyczoge1xyXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1IZWFkZXJzJzogdHJ1ZSxcclxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctTWV0aG9kcyc6IHRydWUsXHJcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU9yaWdpbic6IHRydWUsXHJcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LUNyZWRlbnRpYWxzJzogdHJ1ZSxcclxuICAgICAgICAgIH0sXHJcbiAgICAgICAgfSxcclxuICAgICAgXSxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEdFVCAvd2F0Y2hlcyAod2l0aCBhdXRoKVxyXG4gICAgd2F0Y2hlcy5hZGRNZXRob2QoJ0dFVCcsIHdhdGNoSW50ZWdyYXRpb24sIHtcclxuICAgICAgYXV0aG9yaXplcixcclxuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuQ09HTklUTyxcclxuICAgIH0pO1xyXG5cclxuICAgIC8vIFBPU1QgL3dhdGNoZXMgKHdpdGggYXV0aClcclxuICAgIHdhdGNoZXMuYWRkTWV0aG9kKCdQT1NUJywgd2F0Y2hJbnRlZ3JhdGlvbiwge1xyXG4gICAgICBhdXRob3JpemVyLFxyXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gICAgLy8gL3dhdGNoZXMve3dhdGNoSWR9IFJlc291cmNlIE1ldGhvZHNcclxuICAgIC8vID09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT1cclxuXHJcbiAgICBjb25zdCB3YXRjaElkID0gd2F0Y2hlcy5hZGRSZXNvdXJjZSgne3dhdGNoSWR9Jyk7XHJcblxyXG4gICAgLy8gT1BUSU9OUyAvd2F0Y2hlcy97d2F0Y2hJZH0gKG5vIGF1dGgpXHJcbiAgICB3YXRjaElkLmFkZE1ldGhvZCgnT1BUSU9OUycsIG9wdGlvbnNNb2NrSW50ZWdyYXRpb24sIHtcclxuICAgICAgbWV0aG9kUmVzcG9uc2VzOiBbXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgc3RhdHVzQ29kZTogJzIwMCcsXHJcbiAgICAgICAgICByZXNwb25zZVBhcmFtZXRlcnM6IHtcclxuICAgICAgICAgICAgJ21ldGhvZC5yZXNwb25zZS5oZWFkZXIuQWNjZXNzLUNvbnRyb2wtQWxsb3ctSGVhZGVycyc6IHRydWUsXHJcbiAgICAgICAgICAgICdtZXRob2QucmVzcG9uc2UuaGVhZGVyLkFjY2Vzcy1Db250cm9sLUFsbG93LU1ldGhvZHMnOiB0cnVlLFxyXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1PcmlnaW4nOiB0cnVlLFxyXG4gICAgICAgICAgICAnbWV0aG9kLnJlc3BvbnNlLmhlYWRlci5BY2Nlc3MtQ29udHJvbC1BbGxvdy1DcmVkZW50aWFscyc6IHRydWUsXHJcbiAgICAgICAgICB9LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBHRVQgL3dhdGNoZXMve3dhdGNoSWR9ICh3aXRoIGF1dGgpXHJcbiAgICB3YXRjaElkLmFkZE1ldGhvZCgnR0VUJywgd2F0Y2hJbnRlZ3JhdGlvbiwge1xyXG4gICAgICBhdXRob3JpemVyLFxyXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gUEFUQ0ggL3dhdGNoZXMve3dhdGNoSWR9ICh3aXRoIGF1dGgpXHJcbiAgICB3YXRjaElkLmFkZE1ldGhvZCgnUEFUQ0gnLCB3YXRjaEludGVncmF0aW9uLCB7XHJcbiAgICAgIGF1dGhvcml6ZXIsXHJcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLkNPR05JVE8sXHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBERUxFVEUgL3dhdGNoZXMve3dhdGNoSWR9ICh3aXRoIGF1dGgpXHJcbiAgICB3YXRjaElkLmFkZE1ldGhvZCgnREVMRVRFJywgd2F0Y2hJbnRlZ3JhdGlvbiwge1xyXG4gICAgICBhdXRob3JpemVyLFxyXG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5DT0dOSVRPLFxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gICAgLy8gRXZlbnRCcmlkZ2UgU2NoZWR1bGVyXHJcbiAgICAvLyA9PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09XHJcblxyXG4gICAgY29uc3QgcnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnUHJpY2VQb2xsaW5nU2NoZWR1bGUnLCB7XHJcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUucmF0ZShjZGsuRHVyYXRpb24uaG91cnMoNikpLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ1NjaGVkdWxlZCBwcmljZSBwb2xsaW5nIGZvciBhY3RpdmUgd2F0Y2hlcycsXHJcbiAgICB9KTtcclxuICAgIHJ1bGUuYWRkVGFyZ2V0KG5ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKHByaWNlUG9sbGVyKSk7XHJcblxyXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG4gICAgLy8gT3V0cHV0c1xyXG4gICAgLy8gPT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PT09PVxyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdVc2VyUG9vbElkJywge1xyXG4gICAgICB2YWx1ZTogdXNlclBvb2wudXNlclBvb2xJZCxcclxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIFVzZXIgUG9vbCBJRCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnVXNlclBvb2xDbGllbnRJZCcsIHtcclxuICAgICAgdmFsdWU6IHVzZXJQb29sQ2xpZW50LnVzZXJQb29sQ2xpZW50SWQsXHJcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ29nbml0byBVc2VyIFBvb2wgQ2xpZW50IElEJyxcclxuICAgIH0pO1xyXG5cclxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlVcmwnLCB7XHJcbiAgICAgIHZhbHVlOiBhcGkudXJsLFxyXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IFVSTCcsXHJcbiAgICB9KTtcclxuXHJcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ29nbml0b0RvbWFpbicsIHtcclxuICAgICAgdmFsdWU6ICdmYXJlZHJvcC1hdXRoLmF1dGgudXMtZWFzdC0xLmFtYXpvbmNvZ25pdG8uY29tJyxcclxuICAgICAgZGVzY3JpcHRpb246ICdDb2duaXRvIEhvc3RlZCBVSSBEb21haW4nLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59Il19