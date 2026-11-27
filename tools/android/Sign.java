import com.android.apksig.ApkSigner;
import com.android.apksig.ApkVerifier;
import java.io.File;
import java.io.FileInputStream;
import java.security.KeyStore;
import java.security.PrivateKey;
import java.security.cert.X509Certificate;
import java.util.Collections;

// Signs an APK (v2: the app needs Android 8+) with a key from a keystore and verifies the result: args keystore pass alias in out
public class Sign {
  public static void main(String[] a) throws Exception {
    KeyStore ks = KeyStore.getInstance(KeyStore.getDefaultType());
    try (FileInputStream in = new FileInputStream(a[0])) { ks.load(in, a[1].toCharArray()); }
    PrivateKey key = (PrivateKey) ks.getKey(a[2], a[1].toCharArray());
    X509Certificate cert = (X509Certificate) ks.getCertificate(a[2]);
    ApkSigner.SignerConfig sc = new ApkSigner.SignerConfig.Builder("GCDEV", key, Collections.singletonList(cert)).build();
    new ApkSigner.Builder(Collections.singletonList(sc)).setInputApk(new File(a[3])).setOutputApk(new File(a[4]))
      .setMinSdkVersion(26).setV1SigningEnabled(false).setV2SigningEnabled(true).build().sign();
    ApkVerifier.Result r = new ApkVerifier.Builder(new File(a[4])).build().verify();
    System.out.println("verified " + r.isVerified() + " v1 " + r.isVerifiedUsingV1Scheme() + " v2 " + r.isVerifiedUsingV2Scheme());
    for (Object e : r.getErrors()) System.out.println("error " + e);
    for (Object w : r.getWarnings()) System.out.println("warning " + w);
    java.security.MessageDigest md = java.security.MessageDigest.getInstance("SHA-256");
    StringBuilder sb = new StringBuilder(); for (byte b : md.digest(cert.getEncoded())) sb.append(String.format("%02x", b));
    System.out.println("cert " + cert.getSubjectX500Principal() + " sha256 " + sb);
  }
}
