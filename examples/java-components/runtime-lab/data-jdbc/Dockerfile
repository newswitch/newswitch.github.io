ARG JAVA_IMAGE=eclipse-temurin:25-jre
FROM ${JAVA_IMAGE}
WORKDIR /app
COPY --chown=10001:10001 target/data-jdbc-lab-1.0.0.jar app.jar
USER 10001:10001
EXPOSE 8087
ENV SERVER_ADDRESS=0.0.0.0
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
