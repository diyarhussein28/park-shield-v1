import { Redirect, useLocalSearchParams } from 'expo-router';

/** Universal Link / App Link https://park-shield.de/app/alerts/<id> → the alert screen. */
export default function AlertDeepLink() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <Redirect href={{ pathname: '/alerts/[id]', params: { id } }} />;
}
