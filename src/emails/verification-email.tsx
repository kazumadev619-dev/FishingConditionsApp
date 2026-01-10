import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Preview,
  Section,
  Text,
} from '@react-email/components';

interface VerificationEmailProps {
  verificationUrl: string;
  purpose: 'signup' | 'social-link';
}

export const VerificationEmail = ({ verificationUrl, purpose }: VerificationEmailProps) => (
  <Html>
    <Head />
    <Preview>メールアドレスの確認</Preview>
    <Body style={main}>
      <Container style={container}>
        <Heading style={h1}>メールアドレスの確認</Heading>
        {purpose === 'signup' && (
          <>
            <Text style={text}>Fishing Conditions Appへようこそ！</Text>
            <Text style={text}>
              ご登録ありがとうございます。
              サービスを安全にご利用いただくため、メールアドレスの確認をお願いします。
              下のボタンをクリックして、メールアドレスを確認してください。
            </Text>
          </>
        )}
        {purpose === 'social-link' && (
          <>
            <Text style={text}>Fishing Conditions Appへようこそ！</Text>
            <Text style={text}>
              既存のアカウントにGoogleアカウントを連携するため、メールアドレスの確認が必要です。
              下のボタンをクリックして、メールアドレスを確認してください。
            </Text>
          </>
        )}
        <Section style={buttonContainer}>
          <Button style={button} href={verificationUrl}>
            メールアドレスを確認する
          </Button>
        </Section>
        <Text style={text}>このリンクは1時間有効です。</Text>
        <Text style={footer}>このメールに心当たりがない場合は、無視してください。</Text>
      </Container>
    </Body>
  </Html>
);

export default VerificationEmail;

// スタイル定義
const main = {
  backgroundColor: '#f6f9fc',
  fontFamily:
    '-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Ubuntu,sans-serif',
};

const container = {
  backgroundColor: '#ffffff',
  margin: '0 auto',
  padding: '20px 0 48px',
  marginBottom: '64px',
};

const h1 = {
  color: '#333',
  fontSize: '24px',
  fontWeight: 'bold',
  margin: '40px 0',
  padding: '0',
  textAlign: 'center' as const,
};

const text = {
  color: '#333',
  fontSize: '16px',
  lineHeight: '26px',
  margin: '16px 8px',
};

const buttonContainer = {
  textAlign: 'center' as const,
  margin: '32px 0',
};

const button = {
  backgroundColor: '#0070f3',
  borderRadius: '5px',
  color: '#fff',
  fontSize: '16px',
  fontWeight: 'bold',
  textDecoration: 'none',
  textAlign: 'center' as const,
  display: 'block',
  padding: '12px 20px',
};

const footer = {
  color: '#8898aa',
  fontSize: '12px',
  lineHeight: '16px',
  margin: '16px 8px',
};
