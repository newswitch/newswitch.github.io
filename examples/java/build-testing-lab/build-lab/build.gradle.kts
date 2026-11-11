plugins {
    application
}

group = "io.newswitch.learning"
version = "1.0.0"

repositories {
    mavenCentral()
}

java {
    toolchain {
        languageVersion.set(JavaLanguageVersion.of(25))
    }
}

application {
    mainClass.set("demo.tasks.App")
}

dependencies {
    testImplementation(platform("org.junit:junit-bom:6.0.3"))
    testImplementation("org.junit.jupiter:junit-jupiter")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

dependencyLocking {
    lockAllConfigurations()
}

tasks.withType<JavaCompile>().configureEach {
    options.encoding = "UTF-8"
    options.release.set(25)
}

tasks.withType<Test>().configureEach {
    useJUnitPlatform()
    maxParallelForks = 1
}

tasks.test {
    exclude("**/*IT.class")
}

tasks.jar {
    manifest {
        attributes["Main-Class"] = "demo.tasks.App"
    }
}

val integrationTest by tasks.registering(Test::class) {
    description = "Runs packaged application checks"
    group = "verification"
    testClassesDirs = sourceSets.test.get().output.classesDirs
    classpath = sourceSets.test.get().runtimeClasspath
    include("**/*IT.class")
    dependsOn(tasks.jar)
    shouldRunAfter(tasks.test)
    systemProperty("app.jar", tasks.jar.get().archiveFile.get().asFile.absolutePath)
}

tasks.check {
    dependsOn(integrationTest)
}

tasks.withType<AbstractArchiveTask>().configureEach {
    isPreserveFileTimestamps = false
    isReproducibleFileOrder = true
}
